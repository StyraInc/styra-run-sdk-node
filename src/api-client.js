import Http from "http"
import Https from "https"
import Path from "path"
import Url from "url"
import { StyraRunError, StyraRunHttpError } from "./errors.js"
import { getBody } from "./helpers.js"

// TODO: Re-fetch gateway list after some time (?)
// TODO: Make it configurable to cap retry limit at gateway list size (?)

const OK = 200

function DEFAULT_SORT_GATEWAYS_CALLBACK(gateways) {
  return gateways
}

export class ApiClient {
  constructor(url, token, {
    sortGateways = DEFAULT_SORT_GATEWAYS_CALLBACK,
    maxRetries = 3
  } = {}) {
    this.url = Url.parse(url)
    this.token = token
    this.sortGateways = sortGateways
    this.maxRetries = maxRetries
  }

  async get(path) {
    return await this.requestWithRetry({
      path: path,
      method: 'GET',
      headers: {
        'authorization': `bearer ${this.token}`
      }
    })
  }

  async put(path, data) {
    return await this.requestWithRetry({
      path: path,
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'authorization': `bearer ${this.token}`
      }
    }, data)
  }

  async post(path, data) {
    return await this.requestWithRetry({
      path: path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `bearer ${this.token}`
      }
    }, data)
  }

  async delete(path) {
    return await this.requestWithRetry({
      path: path,
      method: 'DELETE',
      headers: {
        'authorization': `bearer ${this.token}`
      }
    })
  }

  // TODO: always consume and return JSON
  async requestWithRetry(options, data = undefined, attempt = 1) {
    const gateways = await this.getGateways()
    if (!gateways || gateways.length === 0) {
      throw new StyraRunError('No gateways', undefined, undefined, err)
    }
    const maxRetries = Math.min(this.maxRetries, gateways.length - 1)

    try {
      const urlOpts = urlToRequestOptions(gateways[(attempt - 1) % gateways.length], options.path)

      const opts = {
        ...options,
        ...urlOpts
      }

      return await this.request(opts, data)
    } catch (err) {
      switch (err.statusCode) {
        case undefined: // Unknown error
        case 421: // Misdirected Request
        case 500: // Internal Server Error
        case 502: // Bad Gateway
        case 503: // Service Unavailable
        case 504: // Gateway Timeout
          if (attempt <= maxRetries) {
            return await this.requestWithRetry(options, data, attempt+1)
          }
      }
      err.attempts = attempt
      throw err
    }
  }

  async request(options, data = undefined) {
    return new Promise((resolve, reject) => {
      try {
        const client = options.https === false ? Http : Https
        const req = client.request(options, async (response) => {
          let body = await getBody(response);
          switch (response.statusCode) {
            case OK:
              resolve(body);
              break;
            default:
              reject(new StyraRunHttpError(`Unexpected status code: ${response.statusCode}`,
                response.statusCode, body));
          }
        }).on('error', (err) => {
          reject(new Error('Failed to send request', {
            cause: err
          }))
        })
        if (data) {
          req.write(data);
        }
        req.end()
      } catch (err) {
        reject(new Error('Failed to send request', {
          cause: err
        }))
      }
    })
  }

  async getGateways() {
    if (this.gateways) {
      return this.gateways
    }

    const options = {
      ...urlToRequestOptions(this.url, 'gateways'),
      method: 'GET',
      headers: {
        'authorization': `bearer ${this.token}`
      }
    }

    const body = await this.request(options)
    const gateways = JSON.parse(body)
    const sortedGateways = await this.sortGateways(gateways?.result ?? [])

    if (!sortedGateways || sortedGateways.length === 0) {
      throw new StyraRunError('No gateways')
    }

    this.gateways = sortedGateways
      .map((gateway) => {
        try {
          return Url.parse(gateway.gateway_url)
        } catch (err) {
          return undefined
        }
      })
      .filter((entry) => entry !== undefined)
    return this.gateways
  }
}



function urlToRequestOptions(url, path = undefined) {
  return {
    host: url.hostname,
    port: url.port,
    path: joinPath(url.path, path),
    https: url.protocol === 'https:'
  }
}

function joinPath(...components) {
  const filtered = components.filter((comp) => comp !== undefined)
  return Path.join(...filtered)
}

