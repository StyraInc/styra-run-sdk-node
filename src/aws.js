import Url from "url"
import { StyraRunHttpError } from "./errors.js"
import { httpRequest, joinPath, urlToRequestOptions } from "./helpers.js"
import { AWS_IMDSV2_URL, AWS_IMDSV2_TOKEN_TTL } from "./constants.js"

const TOKEN_PATH = '/latest/api/token'
const METADATA_PATH = '/latest/meta-data'

function is401Error(err) {
  return err instanceof StyraRunHttpError && err.isUnauthorizedStatus()
}

export class AwsClient {
  // separate file for all constant configs?
  constructor(url = AWS_IMDSV2_URL, tokenTtl = AWS_IMDSV2_TOKEN_TTL) {
    this.reqOpts = urlToRequestOptions(Url.parse(url))
    this.tokenTtl = tokenTtl
  }

  async getMetadata(retryAuthz = true) {
    if (this.metadata) {
      return this.metadata
    }

    const token = await this.getToken()
    const [regionResult, zoneIdResult] = await Promise.allSettled([
      this.requestMetadata('placement/region', token),
      this.requestMetadata('placement/availability-zone-id', token)])

    if (retryAuthz && token !== undefined && (is401Error(regionResult.reason) || is401Error(zoneIdResult.reason))) {
      this.token = undefined
      return await this.getMetadata(false)
    }
    
    this.metadata = {
      zoneId: zoneIdResult.value,
      region: regionResult.value
    }
    return this.metadata
  }

  async getToken() {
    if (this.tokenIsUnsupported) {
      return
    }

    if (this.token) {
      return this.token
    }

    const options = {
      ...this.reqOpts,
      method: 'PUT',
      path: TOKEN_PATH,
      headers: {
        'X-aws-ec2-metadata-token-ttl-seconds': this.tokenTtl
      }
    }

    try {
      this.token = await httpRequest(options)
      return this.token
    } catch (err) {
      this.tokenIsUnsupported = true
    }
  }

  async requestMetadata(category, token) {
    const options = {
      ...this.reqOpts,
      method: 'GET',
      path: joinPath(METADATA_PATH, category),
    }
  
    if (token) {
      options.headers = {
        'X-aws-ec2-metadata-token': token
      }
    }
  
    const value = await httpRequest(options)
    return removeTrailingSlash(value)
  }
}

function removeTrailingSlash(str) {
  if (!str) {
    return
  }
  return str.endsWith('/') ? str.slice(0, -1) : str
}