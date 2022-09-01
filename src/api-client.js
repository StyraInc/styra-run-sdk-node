import Url from "url"
import {AwsClient} from "./aws.js"
import {StyraRunError, TimeoutError} from "./errors.js"
import {fromJson, httpRequest, urlToRequestOptions} from "./helpers.js"
import {API_CLIENT_MAX_RETRIES, AWS_IMDSV2_URL} from "./constants.js"

// TODO: Re-fetch gateway list after some time (?)
// TODO: Make it configurable to cap retry limit at gateway list size (?)

const EventType = {
  ORGANIZE_GATEWAYS: 'organize-gateways'
}

/**
 * Connectivity options
 * 
 * @typedef {Object} ClientOptions
 * @property {string|string[]} organizeGatewaysStrategy a named organize-gateways strategy, or a list of strategies. If one fails, the next in the list is tried.
 * @property {number} organizeGatewaysStrategyTimeout number of miliseconds deciding a organize-gateways strategy has failed, and the next strategy is used, if more than one; or an unorganized list of gateways will be returned (if asyncGatewayOrganization==false).
 * @property {boolean} asyncGatewayOrganization if `true`, the organize-gateways strategy is called asynchronously, and requests wil be made against an unorganized gateway list the strategy result is still pending. Once completed, the organized gateway list is used for subsequent requests.
 * @property {number} maxRetries number of retries before aborting. Retries are made against the next gateway in the gateway list.
 * @property {SdkEventListener[]} eventListeners
 */
/**
 * @param {string} url The `Styra Run` API URL
 * @param {string} token the API key (Bearer token) to use for calls to the `Styra Run` API
 * @param {ClientOptions} options
 */
export class ApiClient {
  constructor(url, token, {
    organizeGatewaysStrategy = OrganizeGatewayStrategy.AWS, // TODO: ['aws', 'latency']
    organizeGatewaysStrategyTimeout = 2_000,
    asyncGatewayOrganization = true,
    maxRetries = API_CLIENT_MAX_RETRIES,
    eventListeners = []
  } = {}) {
    this.url = Url.parse(url)
    this.token = token
    this.organizeGatewaysStrategy = organizeGatewaysStrategy
    this.organizeGatewaysStrategyTimeout = organizeGatewaysStrategyTimeout
    this.asyncGatewayOrganization = asyncGatewayOrganization
    this.maxRetries = maxRetries
    this.eventListeners = eventListeners
  }

  signalEvent(type, info) {
    this.eventListeners.forEach((listener) => listener(type, info))
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
        // FIXME: remove 500?
        case 500: // Internal Server Error 
        case 502: // Bad Gateway
        case 503: // Service Unavailable
        case 504: // Gateway Timeout
          if (attempt <= maxRetries) {
            return await this.requestWithRetry(options, data, attempt + 1)
          }
      }
      err.attempts = attempt
      throw err
    }
  }

  async request(options, data = undefined) {
    return await httpRequest(options, data)
  }

  /**
   * If successful, returns an organized list of gateway URLs; otherwise original list of unorganized gateways.
   */
  async organizeGateways(gateways, strategies) {
    const [strategyName, ...remainingStrategies] = strategies
    const strategy = organizeGatewaysStrategies[strategyName]

    if (!strategy) {
      if (remainingStrategies.length > 0) {
        return await this.organizeGateways(gateways, remainingStrategies)
      }
      // No valid strategy, no organized gateways to return
      return
    }

    const organizePromise = new Promise(async (resolve, reject) => {
      try {
        const organizedGateways = await strategy(gateways)
        const gatewayUrls = gatewaysToUrls(organizedGateways)

        if (!gatewayUrls || gatewayUrls.length === 0) {
          throw new StyraRunError('No gateways')
        }

        this.signalEvent(EventType.ORGANIZE_GATEWAYS, {
          strategy: strategyName, gateways: gatewayUrls
        })
        resolve(gatewayUrls)
      } catch (err) {
        this.signalEvent(EventType.ORGANIZE_GATEWAYS, {
          strategy: strategyName, err
        })
        reject(err)
      }
    })

    const promises = [organizePromise]

    if (this.organizeGatewaysStrategyTimeout > 0) {
      // Only timeout strategy execution if instructed to
      promises.push(new Promise((_, reject) => {
        setTimeout(() => {
          const err = new TimeoutError(this.organizeGatewaysStrategyTimeout)
          this.signalEvent(EventType.ORGANIZE_GATEWAYS, {
            strategy: strategyName, err
          })
          reject(err)
        }, this.organizeGatewaysStrategyTimeout)
      }))
    }

    return await Promise.race(promises)
      .catch(async () => {
        if (remainingStrategies.length > 0) {
          return await this.organizeGateways(gateways, remainingStrategies)
        }
        // Failed to organize gateways; nothing to return
        return
      })
  }

  async getGateways() {
    if (this.organizedGateways) {
      return this.organizedGateways
    }

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
    const gateways = fromJson(body).result || []
    this.gateways = gatewaysToUrls(gateways)

    const strategies = Array.isArray(this.organizeGatewaysStrategy) ? this.organizeGatewaysStrategy : [this.organizeGatewaysStrategy]
    const organizeGatewaysPromise = this.organizeGateways(gateways, strategies)
      .then((organizedGateways) => {
        if (organizedGateways && organizedGateways.length > 0) {
          this.organizedGateways = organizedGateways
          return this.organizedGateways
        }
        return this.gateways
      })
    
    if (this.asyncGatewayOrganization) {
      return this.gateways
    } else {
      return await organizeGatewaysPromise
    }
  }
}

function gatewaysToUrls(gateways) {
  return gateways.map((gateway) => {
    try {
      return Url.parse(gateway.gateway_url)
    } catch (err) {
      return
    }
  })
    .filter((entry) => !!entry)
}

export const OrganizeGatewayStrategy = {
  AWS: 'aws',
  None: 'none'
}

// TODO: Add latency-based strategy: 'latency'
export const organizeGatewaysStrategies = {
  aws: makeAwsStrategy(),
  none: noneStrategy
}

export function makeAwsStrategy(metadataServiceUrl = AWS_IMDSV2_URL) {
  const awsClient = new AwsClient(metadataServiceUrl)
  return async (gateways) => {
    // NOTE: We assume zone-id:s are unique across regions
    const {region, zoneId} = await awsClient.getMetadata()
    if (!region && !zoneId) {
      return gateways
    }

    const copy = [...gateways]
    return copy.sort((a, b) => {
      if (zoneId && a.aws && a.aws.zone_id === zoneId) {
        // always sort matching zone-id higher
        return -1
      }
      if (region && a.aws && a.aws.region === region) {
        // only sort a higher if b doesn't have a matching zone-id
        return (zoneId && b.aws && b.aws.zone_id === zoneId) ? 1 : -1
      }
      return 0
    })
  }
}

function noneStrategy(gateways) {
  return gateways
}
