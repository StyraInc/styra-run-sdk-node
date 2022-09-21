import Url from "url"
import {getBody, toJson, fromJson, pathEndsWith, parsePathParameters} from "./helpers.js"
import {StyraRunError} from "./errors.js"
import {Method} from "./types.js"

const {GET, PUT, DELETE} = Method

const EventType = {
  RBAC: 'rbac',
  GET_ROLES: 'rbac-get-roles',
  GET_BINDING: 'rbac-get-role-binding',
  GET_BINDINGS: 'rbac-get-role-bindings',
  SET_BINDING: 'rbac-set-role-binding',
  DELETE_BINDING: 'rbac-delete-role-binding'
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
 * Compatible with {@link DefaultSessionInputStrategy}
 *
 * @callback CreateRbacAuthzInputCallback
 * @param {IncomingMessage} request the incoming HTTP request
 * @returns {Promise<RbacInputDocument>}
 * @see SessionInputStrategyCallback
 * @see DefaultSessionInputStrategy
 */

/**
 * @typedef {Object} PageResult
 * @property {*[]} result
 * @property {string} page
 */

/**
 * Callback for enumerating string identifiers for known users.
 *
 * If `limit` is set to `0`, no upper limit should be applied to the number of user identifiers to return.
 *
 * @callback PaginateRbacUsersCallback
 * @param {string} page
 * @param {IncomingMessage} request the incoming HTTP request
 * @returns {Promise<PageResult>} an object where the `result` property is a list if string user identifiers
 */

/**
 * A callback that is invoked when a binding is about to be fetched.
 * Must return a boolean, where `true` indicates there exists a user corresponding to `id` and the binding
 * may be returned, and `false` that it must not be returned.
 *
 * @callback OnGetRbacUserBindingCallback
 * @param {string} id the user identifier for the binding to be fetched
 * @param {IncomingMessage} request the incoming HTTP request
 * @returns {Promise<boolean>} `true`, if the incoming binding fetch is allowed; `false` otherwise
 */

/**
 * A callback that is invoked when a binding is about to be upserted.
 * Must return a boolean, where `true` indicates there is a user corresponding to `id` and the binding may be
 * created, and `false` that it must not be created.
 *
 * When called, implementations may create new users if necessary.
 *
 * @callback OnSetRbacUserBindingCallback
 * @param {string} id the user identifier for the incoming binding
 * @param {string[]} roles the roles to be bound to the user
 * @param {IncomingMessage} request the incoming HTTP request
 * @returns {Promise<boolean>} `true`, if the incoming binding upsert is allowed; `false` otherwise
 */

/**
 * A callback that is invoked when a binding is about to be deleted.
 * Must return a boolean, where `true` indicates there exists a user corresponding to `id` and the binding
 * may be deleted, and `false` that it must not be deleted.
 *
 * @callback OnDeleteRbacUserBindingCallback
 * @param {string} id the user identifier for the binding to be deleted
 * @param {IncomingMessage} request the incoming HTTP request
 * @returns {Promise<boolean>} `true`, if the incoming binding delete is allowed; `false` otherwise
 */

/**
 * RBAC management client.
 */
export class RbacManager {
  /**
   * @param {StyraRunClient} styraRunClient
   * @param {CreateRbacAuthzInputCallback} createAuthzInput
   * @param {PaginateRbacUsersCallback} paginateUsers
   * @param {OnGetRbacUserBindingCallback} onGetUserBinding
   * @param {OnSetRbacUserBindingCallback} onSetUserBinding
   * @param {OnDeleteRbacUserBindingCallback} onDeleteUserBinding
   */
  constructor(styraRunClient,
              {
                paginateUsers,
                createAuthzInput,
                onGetRoleBinding: onGetUserBinding,
                onSetRoleBinding: onSetUserBinding,
                onDeleteRoleBinding: onDeleteUserBinding
              } = {}) {
    this.styraRunClient = styraRunClient
    this.paginateUsers = paginateUsers
    this.createAuthzInput = createAuthzInput
    this.onGetUserBinding = onGetUserBinding
    this.onSetUserBinding = onSetUserBinding
    this.onDeleteRoleBinding = onDeleteUserBinding
  }

  /**
   * Gets the list of available rule identifiers.
   *
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<string[]>} a list of string role identifiers
   */
  async getRoles(authzInput) {
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    const roles = await this.styraRunClient.query(RbacPath.ROLES)
      .then(resp => resp.result)

    this.styraRunClient.signalEvent(EventType.GET_ROLES, {input: authzInput, roles})

    return roles
  }

  /**
   * @typedef {Object} UserBinding
   * @property {string} id the user identifier
   * @property {string[]} roles the list of role identifiers bound to the user
   */
  /**
   * Gets a list of user bindings corresponding to the provided list of user identifiers.
   *
   * @param {string[]} users the list of string identifiers for the users to retrieve bindings for
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<UserBinding[]>} the list of user bindings
   */
  async getUserBindings(users, authzInput) {
    const tenant = getTenant(authzInput)
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    const bindings = await Promise.all(users.map(async (id) => {
      const roles = await this.styraRunClient.getData(`${RbacPath.BINDINGS_PREFIX}/${tenant}/${id}`, [])
        .then(resp => resp.result)
      return {id, roles}
    }))

    this.styraRunClient.signalEvent(EventType.GET_BINDINGS, {input: authzInput, bindings})

    return bindings
  }

  /**
   * Lists all user bindings.
   *
   * Note: this function is primarily meant for systems with few user bindings stored in Styra Run,
   * and its use is not recommended when a large amount of user bindings might get enumerated.
   * It is recommended to use {@link getUserBindings} instead, where the number of returned bindings can be controlled by the caller.
   *
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<UserBinding[]>} the list of user bindings
   */
  async listUserBindings(authzInput) {
    const tenant = getTenant(authzInput)
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    const bindingsByUser = await this.styraRunClient.getData(`${RbacPath.BINDINGS_PREFIX}/${tenant}`, {})
      .then(resp => resp.result)

    const bindings = Object.keys(bindingsByUser).map((id) => ({id, roles: bindingsByUser[id]}))

    this.styraRunClient.signalEvent(EventType.GET_BINDINGS, {input: authzInput, bindings})

    return bindings
  }

  /**
   * Gets the binding for a given user.
   *
   * @param {string} id the user identifier
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<string[]>}
   */
  async getUserBinding(id, authzInput) {
    const tenant = getTenant(authzInput)
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    try {
      const {result} = await this.styraRunClient.getData(`${RbacPath.BINDINGS_PREFIX}/${tenant}/${id}`)
      this.styraRunClient.signalEvent(EventType.GET_BINDING, {id, input: authzInput, binding: result})
      return result || []
    } catch (err) {
      this.styraRunClient.signalEvent(EventType.GET_BINDING, {id, input: authzInput, err})
      throw new BackendError('Binding fetch failed', err)
    }
  }

  /**
   * Sets the binding for a given user.
   *
   * @param {string} id the user identifier
   * @param {string[]} roles a list of role identifiers
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<void>}
   */
  async setUserBinding(id, roles, authzInput) {
    const tenant = getTenant(authzInput)
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    try {
      await this.styraRunClient.putData(`${RbacPath.BINDINGS_PREFIX}/${tenant}/${id}`, roles ?? [])
      this.styraRunClient.signalEvent(EventType.SET_BINDING, {id, roles, input: authzInput})
    } catch (err) {
      this.styraRunClient.signalEvent(EventType.SET_BINDING, {id, roles, input: authzInput, err})
      throw new BackendError('Binding update failed', err)
    }
  }

  /**
   * Deletes the binding of a given user.
   *
   * @param {string} id the user identifier
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<void>}
   */
  async deleteUserBinding(id, authzInput) {
    const tenant = getTenant(authzInput)
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    try {
      await this.styraRunClient.deleteData(`${RbacPath.BINDINGS_PREFIX}/${tenant}/${id}`)
      this.styraRunClient.signalEvent(EventType.DELETE_BINDING, {id, input: authzInput})
    } catch (err) {
      this.styraRunClient.signalEvent(EventType.DELETE_BINDING, {id, input: authzInput, err})
      throw new BackendError('Binding update failed', err)
    }
  }

  /**
   * A request handler providing an RBAC management endpoint.
   *
   * @param {IncomingMessage} request the incoming HTTP request
   * @param {ServerResponse} response the outgoing HTTP response
   */
  async handle(request, response) {
    let responseBody
    try {
      const input = await this.createAuthzInput(request)
      const url = Url.parse(request.url)

      // GET /roles
      if (request.method === GET && pathEndsWith(url, ['roles'])) {
        const result = await this.getRoles(input)
        responseBody = {result}
      }
      // GET /user_bindings
      else if (request.method === GET && pathEndsWith(url, ['user_bindings'])) {
        if (this.paginateUsers) {
          const page = new URLSearchParams(url.query).get('page')
          const usersResult = await this.paginateUsers(page, request)
          const users = usersResult.result || []
          const bindings = await this.getUserBindings(users, input)
          responseBody = {result: bindings, page: usersResult.page}
        } else {
          const bindings = await this.listUserBindings(input)
          responseBody = {result: bindings}
        }
      }
      // GET /user_bindings/:id
      else if (request.method === GET && pathEndsWith(url, ['user_bindings', '*'])) {
        const {id} = parsePathParameters(url, ['user_bindings', ':id'])
        if (this.onGetUserBinding && await this.onGetUserBinding(id, request) !== true) {
          throw new InvalidInputError(`Get role binding rejected`)
        }
        const result = await this.getUserBinding(id, input)
        responseBody = {result}
      }
      // PUT /user_bindings/:id
      else if (request.method === PUT && pathEndsWith(url, ['user_bindings', '*'])) {
        const {id} = parsePathParameters(url, ['user_bindings', ':id'])
        const body = await getBody(request)
        const roles = await sanitizeBinding(id, fromJson(body), request, this.onSetUserBinding)
        await this.setUserBinding(id, roles, input)
        responseBody = {}
      }
      // DELETE /user_bindings/:id
      else if (request.method === DELETE && pathEndsWith(url, ['user_bindings', '*'])) {
        const {id} = parsePathParameters(url, ['user_bindings', ':id'])
        if (this.onDeleteRoleBinding && await this.onDeleteRoleBinding(id, request) !== true) {
          throw new InvalidInputError(`Delete role binding rejected`)
        }
        await this.deleteUserBinding(id, input)
        responseBody = {}
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

export class Paginators {
  /**
   * @callback GetPagedDataCallback
   * @param {string} page
   * @param {IncomingMessage} request
   * @returns {Promise<PageResult>}
   */

  /**
   * Callback for enumerating string identifiers for known users.
   *
   * If `limit` is set to `0`, no upper limit should be applied to the number of user identifiers to return.
   *
   * @callback GetIndexedDataCallback
   * @param {number} offset an integer index for where in the list of users to start enumerating
   * @param {number} limit an integer number of users to enumerate, starting at `offset`
   * @param {IncomingMessage} request the incoming HTTP request
   * @returns {Promise<PageResult>} a list if string user identifiers
   */

  /**
   * @callback GetTotalCountCallback
   * @param {ServerRequest} request
   * @returns {Promise<number>} total count of data entries available
   */

  /**
   * A paginator that expects the `page` query parameter on the incoming HTTP request to be a positive integer
   * specifying the index (starting at 1) of the requested page.
   *
   * @param {number} pageSize the number of user-bindings to enumerate on each page. If `0`, pagination is disabled
   * @param {GetIndexedDataCallback} producer
   * @param {GetTotalCountCallback|undefined} getTotalCount
   * @returns {GetPagedDataCallback}
   */
  static makeIndexedPaginator(pageSize, producer, getTotalCount = undefined) {
    return async (page, request) => {
      const index = page ? Math.max(parseInt(page), 1) : 1
      if (isNaN(index)) {
        throw new InvalidInputError("'page' is not a valid number")
      }

      let totalPages = undefined
      if (pageSize === 0) {
        totalPages = 1
      } else if (getTotalCount) {
        const totalCount = await getTotalCount(request)
        totalPages = Math.ceil(totalCount / pageSize)
      }

      const offset = Math.max(index - 1, 0) * pageSize
      const result = await producer(offset, pageSize, request)
      return {result, page: {index, of: totalPages}}
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

async function sanitizeBinding(id, data, request, onSetRoleBinding) {
  if (!Array.isArray(data)) {
    throw new InvalidInputError('Binding data is not an array')
  }

  const roles = data ?? []

  if (onSetRoleBinding && await onSetRoleBinding(id, roles, request) !== true) {
    throw new InvalidInputError(`Set role binding rejected`)
  }

  return roles
}

function getTenant(authzInput) {
  if (authzInput.tenant) {
    return authzInput.tenant
  }
  throw new StyraRunError('Missing required tenant parameter on authz input document')
}
