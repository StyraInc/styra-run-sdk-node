import Url from "url"
import { AwsClient } from "./aws.js"
import { StyraRunError } from "./errors.js"
import { httpRequest, urlToRequestOptions } from "./helpers.js"

// TODO: Re-fetch gateway list after some time (?)
// TODO: Make it configurable to cap retry limit at gateway list size (?)

export class ApiClient {
  constructor(url, token, {
    organizeGateways = makeOrganizeGatewaysCallback(),
    maxRetries = 3
  } = {}) {
    this.url = Url.parse(url)
    this.token = token
    this.organizeGateways = organizeGateways
    this.maxRetries = maxRetries
  }

  async get(path) {
    return await this.requestWithRetry({
      path,
      method: 'GET',
      headers: {
        'authorization': `bearer ${this.token}`
      }
    })
  }

  async put(path, data) {
    return await this.requestWithRetry({
      path,
      method: 'PUT',
      headers: {
        'content-type': 'application/json',
        'authorization': `bearer ${this.token}`
      }
    }, data)
  }

  async post(path, data) {
    return await this.requestWithRetry({
      path,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `bearer ${this.token}`
      }
    }, data)
  }

  async delete(path) {
    return await this.requestWithRetry({
      path,
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
      throw new StyraRunError('No gateways')
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
    return await httpRequest(options, data)
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
    const gateways = JSON.parse(body)?.result || []
    const organizedGateways = await this.organizeGateways(gateways)
    const gatewayUrls = organizedGateways.map((gateway) => {
        try {
          return Url.parse(gateway.gateway_url)
        } catch (err) {
          return undefined
        }
      })
      .filter((entry) => !!entry)

    

    if (!gatewayUrls || gatewayUrls.length === 0) {
      throw new StyraRunError('No gateways')
    }

    this.gateways = gatewayUrls
    return this.gateways
  }
}

// should probably have a single file with all constants, so we don't have to search for defaults if changed
export function makeOrganizeGatewaysCallback(metadataServiceUrl = 'http://169.254.169.254:80') {
  const awsClient = new AwsClient(metadataServiceUrl)
  return async (gateways) => {
    // NOTE: We assume zone-id:s are unique across regions
    const {region, zoneId} = await awsClient.getMetadata()
    // usually safe to check for falsy conditions with `!` in js; falsy values would be undefined, null, 0, empty string, false https://developer.mozilla.org/en-US/docs/Glossary/Falsy
    if (!region && !zoneId) {
      return gateways
    }

    const copy = [...gateways]
    return copy.sort((a, b) => {
      if (zoneId && a.aws?.zone_id === zoneId) {
        // always sort matching zone-id higher
        return -1
      } 
      if (region && a.aws?.region === region) {
        // only sort a higher if b doesn't have a matching zone-id
        return (zoneId && b.aws?.zone_id === zoneId) ? 1 : -1 
      }
      return 0
    })
  }
}
