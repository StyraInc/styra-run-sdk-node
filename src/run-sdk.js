import Http from "http"
import Https from "https"
import Path from "path"

// TODO: Add support for versioning/ETags for data API requests

export class StyraRunError extends Error {
  constructor(message, path = undefined, query = undefined, cause = undefined) {
    super(message)
    this.name = "StyraRunError"
    this.path = path
    this.query = query
    this.cause = cause
  }
}

export class StyraRunNotAllowedError extends StyraRunError {
  constructor(path = undefined, query = undefined) {
    super(NOT_ALLOWED, path, query)
    this.name = "StyraRunNotAllowedError"
  }
}

export class StyraRunHttpError extends Error {
  constructor(message, statusCode, body) {
    super(message)
    this.name = "HttpError"
    this.statusCode = statusCode
    this.body = body
  }
}

const OK = 200
const FORBIDDEN = 403

export const NOT_ALLOWED = 'Not allowed!'

export class Client {
  options
  namedCheckFunctions

  constructor(options) {
    this.options = options
    this.namedCheckFunctions = {}
  }

  /**
   * Makes an authorization check against a policy rule specified by `'path'`.
   * Where `'path'` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   * Returns a `Promise` that on a successful response resolves to the response body dictionary: `{"result": ...}`.
   *
   * @param path the path to the policy rule to query
   * @param input the input document for the query
   * @returns {Promise<unknown>}
   */
  check(path, input = undefined) {
    const query = input ? {input} : {}
    const reqOpts = {
      ...this.options,
      path: Path.join(this.getPathPrefix(), 'data', path),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `bearer ${this.options.token}`
      }
    }

    return toJson(query)
      .then(query => request(reqOpts, query))
      .then(fromJson)
      .catch(err => {
        return Promise.reject(new StyraRunError('Check failed', path, query, err))
      });
  }

  /**
   * Makes a batched authorization check.
   * The provided `'items'` is a list of dictionaries with the properties:
   * 
   * * `path`: the path to the policy rule to query for this entry
   * * `input`: (optional) the input document for this entry
   * 
   * If, `'input'` is provided, it will be applied across all query items.
   * 
   * Returns a list of result dictionaries; where each entry corresponds to an entry 
   * with the same index in `'items'`.
   * 
   * @param items the list of queries to batch
   * @param input the input document to apply to the entire batch request, or `undefined`
   * @returns a list of result dictionaries
   */
  batchCheck(items, input = undefined) {
    const query = {items}
    if (input) {
      query.input = input
    }

    const reqOpts = {
      ...this.options,
      path: Path.join(this.getPathPrefix(), 'data_batch'),
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `bearer ${this.options.token}`
      }
    }

    return toJson(query)
      .then(query => request(reqOpts, query))
      // .then(fromJson)
      .then((data) => {
        return fromJson(data)
      })
      .catch(err => {
        return Promise.reject(new StyraRunError('Batched check failed', undefined, query, err))
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
  allowed(path, input = undefined, data = undefined) {
    return new Promise((resolve, reject) => {
      this.check(path, input)
        .then((response) => {
          if (response.result === true) {
            if (data) {
              return resolve(data)
            }
            return resolve()
          }
          reject(new StyraRunNotAllowedError(path, {input}))
        })
        .catch((err) => {
          reject(new StyraRunError('Allow check failed', path, {input}, err))
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
   * @param toInput optional, a callback that, given a list entry and an index, should return an `input` document
   * @param toPath optional, a callback that, given a list entry and an index, should return a `path` string. If provided, overrides the global `'path'` argument
   * @returns {Promise<Awaited<unknown>[]>}
   */
  filterAllowed(list, path = undefined, toInput = undefined, toPath = undefined) {
    if (list.length === 0) {
      return Promise.resolve([])
    }

    const transformer = (entry, i) => {
        const item = {}
  
        const itemInput = toInput ? toInput(entry, i) : undefined
        if (itemInput) {
          item.input = itemInput
        }
  
        const itemPath = toPath ? toPath(entry, i) : undefined
        item.path = itemPath ?? path
        if (item.path === undefined) {
          throw new StyraRunError(`No 'path' provided for list entry at ${i}`)
        }
  
        return item
    }

    return new Promise((resolve, reject) => {
      try {
        const items = list.map(transformer)
        resolve(items)
      } catch (err) {
        reject(err)
      }
    })
      .then((items) => this.batchCheck(items))
      .then((response) => new Promise((resolve, reject) => {
        const resultList = response.result ?? []
        if (resultList.length !== list.length) {
          reject(new StyraRunError(`Returned result list size (${resultList.length}) not equal to provided list size (${list.length})`, 
            path, query, err))
        }
        const filtered = list.filter((_, i) => resultList[i]?.check?.result === true)
        resolve(filtered)
      }))
      .catch(err => {
        return Promise.reject(new StyraRunError('Allow filtering failed', path, undefined, err))
      });
  }

  /**
   * Fetch data from the `Styra Run` data API.
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
      path: Path.join(this.getPathPrefix(), 'data', path),
      method: 'GET',
      headers: {
        'authorization': `bearer ${this.options.token}`
      }
    };

    return request(reqOpts)
      .then(fromJson)
      .catch((err) => {
        if (def && err.resp?.statusCode === 404) {
          return {result: def}
        }
        return Promise.reject(new StyraRunError('GET data request failed', path, undefined, err))
      });
  }

  /**
   * Upload data to the `Styra Run` data API.
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
      path: Path.join(this.getPathPrefix(), 'data', path),
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.options.token}`
      }
    };

    return toJson(data)
      .then((data) => request(reqOpts, data))
      .then(fromJson)
      .catch((err) => {
        return Promise.reject(new StyraRunError('PUT data request failed', path, undefined, err))
      });
  }

  /**
   * Remove data from the `Styra Run` data API.
   * Where `'path'` is the trailing component(s) of the full request path `"/v1/projects/${UID}/${PID}/envs/${EID}/data/${path}"`
   * Returns a `Promise` that on a successful response resolves to the response body dictionary: `{"version": ...}`.
   *
   * @param path the path identifying the data to remove
   * @returns {Promise<unknown>}
   */
  deleteData(path) {
    const reqOpts = {
      ...this.options,
      path: Path.join(this.getPathPrefix(), 'data', path),
      method: 'DELETE',
      headers: {
        'authorization': `bearer ${this.options.token}`
      }
    };

    return request(reqOpts)
      .then(fromJson)
      .catch(err => {
        return Promise.reject(new StyraRunError('DELETE data request failed', path, undefined, err))
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
      return await namedCheck(this, input)
    }

    throw new StyraRunError(`Named check function '${name}' not found`)
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

      let checkResult;
      try {
        if (checkName) {
          checkResult = await this.callNamedCheck(checkName, input)
        } else {
          checkResult = await this.check(path, input)
        }
      } catch (e) {
        checkResult = undefined
      }

      if (checkResult?.result === undefined) {
        return res.status(FORBIDDEN).end()
      }

      return res.status(OK).json(checkResult).end()
    }
  }

  getPathPrefix() {
    return `/v1/projects/${this.options.uid}/${this.options.pid}/envs/${this.options.eid}`
  }
}

/**
 * Construct a new `Styra Run` Client from the passed `options` dictionary.
 * Valid options are:
 * * `host`: (string) The `Styra Run` API host name
 * * `port`: (number) The `Styra Run` API port
 * * `https`: (boolean) Whether to use TLS for calls to the `Styra Run` API (default: true)
 * * `pid`: (string) Project ID
 * * `eid`: (string) Environment ID
 * * `uid`: (string) User ID
 * * `token`: (string) the API key (Bearer token) to use for calls to the `Styra Run` API
 *
 * @param options
 * @returns {Client}
 * @constructor
 */
function New(options) {
  return new Client(options);
}

function request(options, data) {
  return new Promise((resolve, reject) => {
    try {
      const client = options.https === false ? Http : Https
      const req = client.request(options, (response) => {
        let body = '';

        //another chunk of data has been received
        response.on('data', (chunk) => {
          body += chunk;
        });

        //the whole response has been received
        response.on('end', () => {
          switch (response.statusCode) {
            case OK:
              resolve(body);
              break;
            default:
              reject(new StyraRunHttpError(`Unexpected status code: ${response.statusCode}`, 
                response.statusCode, body));
          }
        });
      }).on('error', (err) => {
        reject(new Error('Failed to send request', {
          cause: err
        }))
      });
      if (data) {
        req.write(data);
      }
      req.end()
    } catch (err) {
      reject(new Error('Failed to send request', {
        cause: err
      }))
    }
  });
}

async function toJson(data) {
  const json = JSON.stringify(data);
  if (json) {
    return json
  } else {
    throw new Error('JSON serialization produced undefined result')
  }
}

async function fromJson(str) {
  try {
    return JSON.parse(str)
  } catch (err) {
    throw new Error('Invalid JSON in response', {cause: err})
  }
}

export default {
  New
}