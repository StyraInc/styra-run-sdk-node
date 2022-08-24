import Http from "http"
import Https from "https"
import Path from "path"
import { StyraRunError, StyraRunHttpError } from "./errors.js";

export const OK = 200

export async function httpRequest(options, data = undefined) {
  return new Promise((resolve, reject) => {
    try {
      const client = options.https === false ? Http : Https

      const request = client.request(options, async (response) => {
        const body = await getBody(response);
        switch (response.statusCode) {
          case OK:
            resolve(body);
            break;
          default:
            reject(new StyraRunHttpError(`Unexpected status code: ${response.statusCode}`,
              response.statusCode, body));
        }
      }).on('error', (err) => {
        reject(new StyraRunError('Failed to send request', err))
      })

      if (data) {
        request.write(data);
      }
      request.end()
    } catch (err) {
      reject(new StyraRunError('Failed to send request', err))
    }
  })
}

export function getBody(stream) {
  return new Promise((resolve) => {
    if (stream.body) {
      // express compatibility
      resolve(stream.body)
    } else {
      let body = ''

      stream.on('data', (data) => {
        body += data
      })

      stream.on('end', () => {
        resolve(body)
      })
    }
  })
}

export function toJson(data) {
  const json = JSON.stringify(data);

  if (json) {
    return json
  } else {
    throw new Error('JSON serialization produced undefined result')
  }
}

export function fromJson(value) {
  if (typeof value === 'object') {
    return value
  }

  try {
    return JSON.parse(value)
  } catch (err) {
    throw new Error('Invalid JSON', {cause: err})
  }
}

export function pathEndsWith(url, tail) {
  const segments = url.pathname.split('/')
    .filter((e) => e.length > 0)

  if (tail.length > segments.length) {
    return false
  }

  const tailStart = segments.length - tail.length
  const pathTail = segments.slice(tailStart)

  return !tail.some((required, index) => required !== '*' && required !== pathTail[index])
}

export function parsePathParameters(url, tail) {
  const segments = url.pathname.split('/')
  if (tail.length > segments.length) {
    return {}
  }

  const tailStart = segments.length - tail.length
  const pathTail = segments.slice(tailStart)

  return tail.reduce((parameters, expected, index) => {
    if (expected.startsWith(':')) {
      parameters[expected.slice(1)] = pathTail[index]
    }

    return parameters
  }, {})
}

export function joinPath(...args) {
  const filtered = args.filter((arg) => arg !== undefined)
  const path = Path.join(...filtered)
  return path.startsWith('/') ? path : `/${path}`
}

export function urlToRequestOptions(url, path = undefined) {
  return {
    host: url.hostname,
    port: url.port,
    path: joinPath(url.path, path),
    https: url.protocol === 'https:'
  }
}