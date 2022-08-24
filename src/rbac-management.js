import Url from "url"
import { getBody, toJson, fromJson, pathEndsWith, parsePathParameters } from "./helpers.js"
import { StyraRunError } from "./errors.js"

const EventType = {
  RBAC: 'rbac',
  GET_ROLES: 'rbac-get-roles',
  GET_BINDINGS: 'rbac-get-bindings',
  SET_BINDING: 'rbac-set-binding'
}

const RbacPath = {
  AUTHZ: 'rbac/manage/allow',
  ROLES: 'rbac/roles', 
  BINDINGS_PREFIX: 'rbac/user_bindings'
}

const JSON_CONTENT_TYPE = {'Content-Type': 'application/json'}
const TEXT_CONTENT_TYPE = {'Content-Type': 'text/plain'}

export class Manager {
  constructor(styraRunClient, createInput, getUsers, onSetBinding, pageSize) {
    this.styraRunClient = styraRunClient
    this.createInput = createInput
    this.getUsers = getUsers
    this.onSetBinding = onSetBinding
    this.pageSize = Math.max(pageSize, 0)
  }

  async getRoles(input) {
    await this.styraRunClient.assert(RbacPath.AUTHZ, input)

    const roles = await this.styraRunClient.query(RbacPath.ROLES, input)
      .then(resp => resp.result)

    this.styraRunClient.signalEvent(EventType.GET_ROLES, {input, roles})

    return roles
  }

  async getBindings(input, page) {
    await this.styraRunClient.assert(RbacPath.AUTHZ, input)

    const offset = Math.max((page ?? 0) - 1, 0) * this.pageSize
    const users = this.getUsers(offset, this.pageSize)

    const bindings = await Promise.all(users.map(async (id) => {
      const roles = await this.styraRunClient.getData(`${RbacPath.BINDINGS_PREFIX}/${input.tenant}/${id}`, [])
        .then(resp => resp.result)
      return {id, roles}
    }))

    this.styraRunClient.signalEvent(EventType.GET_BINDINGS, {input, bindings})

    return bindings
  }

  async setBinding(binding, input) {
    await this.styraRunClient.assert(RbacPath.AUTHZ, input)

    try {
      await this.styraRunClient.putData(`${RbacPath.BINDINGS_PREFIX}/${input.tenant}/${binding.id}`, binding.roles ?? [])
      this.styraRunClient.signalEvent(EventType.SET_BINDING, {binding, input})
    } catch (err) {
      this.styraRunClient.signalEvent(EventType.SET_BINDING, {binding, input, err})
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
        response.writeHead(404, TEXT_CONTENT_TYPE)
        response.end('Not Found')
        return
      }

      if (responseBody) {
        response.writeHead(200, JSON_CONTENT_TYPE)
        response.end(toJson(responseBody))
      } else {
        response.writeHead(200, JSON_CONTENT_TYPE)
        response.end()
      }
    } catch (err) {
      this.styraRunClient.signalEvent(EventType.RBAC, {err})
      if (err instanceof StyraRunError) {
        response.writeHead(403, TEXT_CONTENT_TYPE)
        response.end('Forbidden')
      } else if (err instanceof InvalidInputError) {
        response.writeHead(400, TEXT_CONTENT_TYPE)
        response.end('Invalid request')
      } else {
        response.writeHead(500, TEXT_CONTENT_TYPE)
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
