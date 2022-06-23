import http from "http";
import https from "https";
import StatusCodes from "http-status-codes";

// TODO: Tighten error handling
// TODO: Add support for versioning/ETags for data API requests
// TODO: Add support for batched queries
// TODO: Better logging

// export class Options {
//     host
//     port
//     pid
//     eid
//     token
// }

// export class Result {
//     result
//     version
// }

const {OK, FORBIDDEN} = StatusCodes

const NOT_ALLOWED = 'Not allowed!'

export class Client {
  options
  namedCheckFunctions

  constructor(options) {
    this.options = options
    this.namedCheckFunctions = {}
  }

  /**
   * Makes an  authorization check against a policy rule specified by `'path'`.
   * Where `'path'` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   * Returns a `Promise` that on a successful response resolves to the response body dictionary: `{"result": ...}`.
   *
   * @param path the path to the policy rule to query
   * @param input the input document for the query
   * @returns {Promise<unknown>}
   */
  check(path, input) {
    const query = {input: input}
    const reqOpts = {
      ...this.options,
      path: `/v1/projects/${this.options.uid}/${this.options.pid}/envs/${this.options.eid}/data/${path}`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `bearer ${this.options.token}`
      }
    }

    return toJson(query)
      .then(query => request(reqOpts, query))
      .then(JSON.parse)
      .catch(err => {
        return Promise.reject({msg: 'Check request failed', err: err});
      });
  }

  /**
   * Makes an  authorization check against a policy rule wit a boolean return type, specified by `'path'`.
   * Where `'path'` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   * Returns a `Promise`, that on a successful response resolves with no data, or `'data'`, if provided.
   *
   * @param path the path to the policy rule to query
   * @param input the input document for the query
   * @param data optional value to return on allowed
   * @returns {Promise<unknown>}
   */
  allowed(path, input, data = undefined) {
    return new Promise((resolve, reject) => {
      this.check(path, input)
        .then((response) => {
          if (response.result === true) {
            if (data) {
              return resolve(data)
            }
            return resolve()
          }
          return reject({msg: NOT_ALLOWED})
        })
        .catch((err) => {
          console.debug("Allow check failed", err)
          reject(err)
        })
    })
  }

  /**
   * For each entry in the provided `'list'`, an authorization check against a policy rule wit a boolean return type, specified by `'path'` is made.
   * Where `'path'` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   * Returns a `Promise` that resolves to a filtered list.
   *
   * @param path the path to the policy rule to query
   * @param list the list to filter
   * @param toInput a callback that, given a list entry, should return an `input` document for the query
   * @returns {Promise<Awaited<unknown>[]>}
   */
  filterAllowed(path, list, toInput) {
    // TODO: Use batch endpoint, when ready
    return Promise.all(list.map((entry) => {
      const input = toInput(entry)
      console.debug("Filtering: ", path, input)
      return this.check(path, input)
        .then((response) => {
          if (response.result === true) {
            return entry
          }
          return undefined
        }).catch((err) => {
          // TODO: Collect errors for later return.
          // FIXME: Can we do an early abort? Should we?
          console.warn("Check to filter entry failed; dropping entry", entry, err)
          return undefined
        })
    }))
      .then((list) => list
        .filter((entry) => entry !== undefined))
  }

  /**
   * Fetch data from the Oz data API.
   * Where `'path'` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   * Returns a `Promise` that on a successful response resolves to the response body dictionary: `{"result": ...}`.
   *
   * @param path the path identifying the data to fetch
   * @param def the default value to return on a `404 Not Found` response
   * @returns {Promise<unknown>}
   */
  getData(path, def = undefined) {
    const reqOpts = {
      ...this.options,
      path: `/v1/projects/${this.options.uid}/${this.options.pid}/envs/${this.options.eid}/data/${path}`,
      method: 'GET',
      headers: {
        'authorization': `bearer ${this.options.token}`
      }
    };
    console.debug("Making GET data request", reqOpts)

    return request(reqOpts)
      .then(JSON.parse)
      .catch((err) => {
        if (def && err.resp?.statusCode === 404) {
          return {result: def}
        }
        return Promise.reject({msg: 'GET data request failed', err: err})
      });
  }

  /**
   * Upload data to the Oz data API.
   * Where `'path'` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`.
   * Returns a `Promise` that on a successful response resolves to the response body dictionary: `{"version": ...}`.
   *
   * @param path the path identifying the data to upload
   * @param data the data to upload
   * @returns {Promise<unknown>}
   */
  putData(path, data) {
    const reqOpts = {
      ...this.options,
      path: `/v1/projects/${this.options.uid}/${this.options.pid}/envs/${this.options.eid}/data/${path}`,
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.options.token}`
      }
    };
    console.debug("Making PUT data request", reqOpts, data)

    return toJson(data)
      .then((data) => request(reqOpts, data))
      .then(JSON.parse)
      .catch((err) => {
        return Promise.reject({msg: `PUT data request to '${reqOpts.path}' failed`, err: err});
      });
  }

  /**
   * Remove data from the Oz data API.
   * Where `'path'` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   * Returns a `Promise` that on a successful response resolves to the response body dictionary: `{"version": ...}`.
   *
   * @param path the path identifying the data to remove
   * @returns {Promise<unknown>}
   */
  deleteData(path) {
    const reqOpts = {
      ...this.options,
      path: `/v1/projects/${this.options.uid}/${this.options.pid}/envs/${this.options.eid}/data/${path}`,
      method: 'DELETE',
      headers: {
        'authorization': `bearer ${this.options.token}`
      }
    };
    console.debug("Making DELETE data request", reqOpts)

    return request(reqOpts)
      .then(JSON.parse)
      .catch(err => {
        return Promise.reject({msg: 'DELETE data request failed', err: err});
      });
  }

  /**
   * Register a named check function.
   *
   * @param name the name of the check function
   * @param onCheck callback returning a `Promise` resolving to the check result body
   */
  registerNamedCheck(name, onCheck) {
    this.namedCheckFunctions[name] = onCheck
  }

  /**
   * Calls a named check function, if found.
   * Returns a `Promise`, resolving to the check result body.
   *
   * @param name the name of the check function
   * @param input the input document to pass to the check function
   * @returns {Promise<*>}
   */
  async callNamedCheck(name, input) {
    const namedCheck = this.namedCheckFunctions[name]

    if (namedCheck) {
      console.debug("Calling named check function", name)
      return await namedCheck(this, input)
    }

    console.warn("Named check function not found", name)
    throw {msg: 'Named check function not found'}
  }

  /**
   * Returns an HTTP proxy function
   *
   * @param onProxy
   * @returns {(function(*, *): Promise<*>)|*}
   */
  proxy(onProxy = undefined) {
    return async (req, res) => {
      const {check: checkName, path: path} = req.body

      let input = req.body.input ?? {}
      if (onProxy) {
        input = await onProxy(req, res, input)
      }

      console.debug('Proxied check:', path, input)

      let checkResult;
      try {
        if (checkName) {
          checkResult = await this.callNamedCheck(checkName, input)
        } else {
          checkResult = await this.check(path, input)
        }
      } catch (e) {
        console.debug("Proxied check failed.", e)
        checkResult = undefined
      }

      if (checkResult?.result === undefined) {
        return res.status(FORBIDDEN).end()
      }

      return res.status(OK).json(checkResult).end()
    }
  }
}

/**
 * Construct a new Oz Client from the passed `options` dictionary.
 * Valid options are:
 * * `host`: (string) The Oz API host name
 * * `port`: (number) The Oz API port
 * * `https`: (boolean) Whether to use TLS for calls to the Oz API (default: true)
 * * `pid`: (string) Project ID
 * * `eid`: (string) Environment ID
 * * `uid`: (string) User ID
 * * `token`: (string) the API key (Bearer token) to use for calls to the Oz API
 *
 * @param options
 * @returns {Client}
 * @constructor
 */
function New(options) {
  return new Client(options);
}

function request(opts, data) {
  return new Promise((resolve, reject) => {
    try {
      const client = opts.https === false ? http : https
      const req = client.request(opts, (response) => {
        let body = '';

        //another chunk of data has been received
        response.on('data', (chunk) => {
          body += chunk;
        });

        //the whole response has been received
        response.on('end', () => {
          switch (response.statusCode) {
            case 200:
              resolve(body);
              break;
            default:
              reject({
                msg: `Unexpected status code: ${response.statusCode}`,
                resp: response,
                body: body
              });
          }
        });
      }).on('error', (err) => {
        reject(err)
      });
      if (data) {
        req.write(data);
      }
      req.end()
    } catch (err) {
      reject(err)
    }
  });
}

function toJson(data) {
  return new Promise((resolve, reject) => {
    const json = JSON.stringify(data);
    if (json) {
      resolve(json)
    } else {
      reject({msg: 'JSON serialization produced undefined result'})
    }
  });
}

export default {
  New
}