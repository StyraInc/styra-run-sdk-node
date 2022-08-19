import Url from "url"
import {getBody, toJson, fromJson, pathEndsWith, parsePathParameters} from "./helpers.js"
import {StyraRunError, StyraRunHttpError} from "./errors.js"
import path from "path"

const AUTHZ_PATH = 'rbac/manage/allow'
const ROLES_PATH = 'rbac/roles'
const BINDINGS_PATH_PREFIX = 'rbac/user_bindings'

export class Manager {
  constructor(styraRunClient, createInput, getUsers, onSetBinding, pageSize) {
    this.styraRunClient = styraRunClient
    this.createInput = createInput
    this.getUsers = getUsers
    this.onSetBinding = onSetBinding
    this.pageSize = Math.max(pageSize, 0)
  }

  async getRoles(input) {
    await this.styraRunClient.assert(AUTHZ_PATH, input)

    const roles = await this.styraRunClient.query(ROLES_PATH, input)
      .then(resp => resp.result)

    this.styraRunClient.signalEvent('rbac-get-roles', {input, roles})

    return roles
  }

  async getBindings(input, page) {
    await this.styraRunClient.assert(AUTHZ_PATH, input)

    let offset = 0
    let limit = this.pageSize
    if (page) {
      offset = Math.max(page - 1, 0) * this.pageSize
    }
    const users = this.getUsers(offset, limit)

    const bindings = await Promise.all(users.map(async (id) => {
      const roles = await this.styraRunClient.getData(`${BINDINGS_PATH_PREFIX}/${input.tenant}/${id}`, [])
        .then(resp => resp.result)
      return {id, roles}
    }))

    this.styraRunClient.signalEvent('rbac-get-bindings', {input, bindings})

    return bindings
  }

  async setBinding(binding, input) {
    await this.styraRunClient.assert(AUTHZ_PATH, input)

    try {
      await this.styraRunClient.putData(`${BINDINGS_PATH_PREFIX}/${input.tenant}/${binding.id}`, binding.roles ?? [])
      this.styraRunClient.signalEvent('rbac-set-binding', {binding, input})
    } catch (err) {
      this.styraRunClient.signalEvent('rbac-set-binding', {binding, input, err})
      throw new BackendError('Bunding update failed', cause)
    }
  }

  async handle(request, response) {
    let responseBody
    try {
      const input = await this.createInput(request)
      const url = Url.parse(request.url)

      if (request.method === 'GET' && pathEndsWith(url, ['roles'])) {
        responseBody = await this.getRoles(input)
      } else if (request.method === 'GET' && pathEndsWith(url, ['user_bindings'])) {
        let page
        if (url.query) {
          const searchParams = new URLSearchParams(url.query)
          const pageStr = searchParams.get('page')
          page = pageStr ? parseInt(pageStr) : undefined
        }
        responseBody = await this.getBindings(input, page)
      } else if (request.method === 'PUT' && pathEndsWith(url, ['user_bindings', '*'])) {
        const params = parsePathParameters(url, ['user_bindings', ':id'])
        const body = await getBody(request)
        const binding = await sanitizeBinding(params.id, fromJson(body), this.onSetBinding)
        responseBody = await this.setBinding(binding, input)
      } else {
        response.writeHead(404, {'Content-Type': 'text/plain'})
        response.end('Not Found')
        return
      }

      if (responseBody) {
        response.writeHead(200, {'Content-Type': 'application/json'})
        response.end(toJson(responseBody))
      } else {
        response.writeHead(200, {'Content-Type': 'application/json'})
        response.end()
      }
    } catch (err) {
      this.styraRunClient.signalEvent('rbac', {err})
      if (err instanceof StyraRunError) {
        response.writeHead(403, {'Content-Type': 'text/plain'})
        response.end('Forbidden')
      } else if (err instanceof InvalidInputError) {
        response.writeHead(400, {'Content-Type': 'text/plain'})
        response.end('Invalid request')
      } else {
        response.writeHead(500, {'Content-Type': 'text/plain'})
        response.end('Error')
      }
    }
  }
}

class InvalidInputError extends Error {
  constructor(message) {
    super(message)
  }
}

class BackendError extends Error {
  constructor(message, cause) {
    super(message, cause)
  }
}


async function sanitizeBinding(id, data, onSetBinding) {
  if (!Array.isArray(data)) {
    throw new InvalidInputError('Binding data is not an array')
  }

  const roles = data ?? []

  if (await onSetBinding(id, roles) !== true) {
    throw new InvalidInputError(`Binding rejected`)
  }

  return {id, roles}
}
