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

/**
 * RBAC management authorization policy input document
 *
 * @typedef {Object} RbacInputDocument
 * @property {string} subject the subject identifying the user performing the RBAC operation
 * @property {string} tenant the tenant of the user performing the RBAC operation
 */

/**
 * Callback for constructing the `input` document for RBAC management authorization policy checks.
 * The `tenant` property of this document is also used for `user_bindings` data queries, and is required.
 *
 * @callback CreateRbacInputCallback
 * @param {IncomingMessage} request the incoming HTTP request
 * @returns {RbacInputDocument}
 */

/**
 * Callback for enumerating string identifiers for known users.
 *
 * If `limit` is set to `0`, no upper limit should be applied to the number of user identifiers to return.
 *
 * @callback GetRbacUsersCallback
 * @param {number} offset an integer index for where in the list of users to start enumerating
 * @param {number} limit an integer number of users to enumerate, starting at `offset`
 * @param {IncomingMessage} request the incoming HTTP request
 * @returns {string[]} a list if string user identifiers
 */

/**
 * A callback that is invoked when a binding is about to be upserted.
 * Must return a boolean, where `true` indicates the binding may be created, and `false`
 * that it must not.
 *
 * When called, implementations may create new users if necessary.
 *
 * @callback OnSetRbacBindingCallback
 * @param {string} id the user identifier for the incoming binding
 * @param {string[]} roles the roles to be bound to the user
 * @param {IncomingMessage} request the incoming HTTP request
 * @returns {boolean} `true`, if the incoming binding upsert is allowed; `false` otherwise
 */

/**
 * RBAC management client.
 */
export class RbacManager {
  /**
   * @param {StyraRunClient} styraRunClient
   * @param {CreateRbacInputCallback} createInput
   * @param {GetRbacUsersCallback} getUsers
   * @param {OnSetRbacBindingCallback} onSetBinding
   * @param {number} pageSize the number of user-bindings to enumerate on each page. If `0`, pagination is disabled
   */
  constructor(styraRunClient, createInput, getUsers, onSetBinding, pageSize) {
    this.styraRunClient = styraRunClient
    this.createInput = createInput
    this.getUsers = getUsers
    this.onSetBinding = onSetBinding
    this.pageSize = Math.max(pageSize, 0)
  }

  async getRoles(input) {
    await this.styraRunClient.assert(RbacPath.AUTHZ, input)

    const roles = await this.styraRunClient.query(RbacPath.ROLES)
      .then(resp => resp.result)

    this.styraRunClient.signalEvent(EventType.GET_ROLES, {input, roles})

    return roles
  }

  async getBindings(input, users) {
    await this.styraRunClient.assert(RbacPath.AUTHZ, input)

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
      throw new BackendError('Binding update failed', err)
    }
  }
  /**
   * A request handler providing an RBAC management endpoint.
   *
   * @param {IncomingMessage} request the incoming HTTP request
   * @param {OutgoingMessage} response the outgoing HTTP response
   */
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

        const offset = Math.max((page || 0) - 1, 0) * this.pageSize
        const users = this.getUsers(offset, this.pageSize, request)

        responseBody = await this.getBindings(input, users)
      } else if (request.method === 'PUT' && pathEndsWith(url, ['user_bindings', '*'])) {
        const params = parsePathParameters(url, ['user_bindings', ':id'])
        const body = await getBody(request)
        const binding = await sanitizeBinding(params.id, fromJson(body), request, this.onSetBinding)

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

async function sanitizeBinding(id, data, request, onSetBinding) {
  if (!Array.isArray(data)) {
    throw new InvalidInputError('Binding data is not an array')
  }

  const roles = data ?? []

  if (await onSetBinding(id, roles, request) !== true) {
    throw new InvalidInputError(`Binding rejected`)
  }

  return {id, roles}
}
