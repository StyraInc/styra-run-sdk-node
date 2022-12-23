import Url from "url";
import {InvalidInputError, StyraRunError} from "./errors.js";
import {toJson, Headers, getBody, fromJson, pathEndsWith, parsePathParameters} from "./helpers.js";
import {EventType} from "./rbac-management.js";
import {DefaultSessionInputStrategy} from "./session.js";
import {Method} from "./types.js"

const {GET, PUT, DELETE} = Method

export const DefaultFunctions = {
  /**
   * Default {@link GetUserId} callback for extracting the user ID from URL paths of the format `** /user_bindings/<userId>`
   */
  getUserIdFromPathParam: (_, request) => {
    const {userId} = parsePathParameters(Url.parse(request.url), ['user_bindings', ':userId'])
    return userId
  },
  getNoUserId: () => null,
}

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
 * @param {RbacInputDocument} authzInput the input value for the authorization query
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
 * @param {RbacInputDocument} authzInput the input value for the authorization query
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
 * @param {RbacInputDocument} authzInput the input value for the authorization query
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
 * @param {RbacInputDocument} authzInput the input value for the authorization query
 * @param {IncomingMessage} request the incoming HTTP request
 * @returns {Promise<boolean>} `true`, if the incoming binding delete is allowed; `false` otherwise
 */

/**
 * @callback GetUserId
 * @param {RbacInputDocument} input the input value for any authorization query
 * @param {IncomingMessage} request the incoming HTTP request
 * @returns {Promise<string>} the ID of the user the request pertains to
 */

export default class RbacProxy {
  /**
   * @param {RbacManager} rbacManager
   * @param {CreateRbacAuthzInputCallback} createAuthzInput
   * @param {PaginateRbacUsersCallback} paginateUsers
   * @param {GetUserId} getUserId
   * @param {OnGetRbacUserBindingCallback} onGetUserBinding
   * @param {OnSetRbacUserBindingCallback} onSetUserBinding
   * @param {OnDeleteRbacUserBindingCallback} onDeleteUserBinding
   */
  constructor(rbacManager,
              {
                createAuthzInput,
                paginateUsers,
                getUserId = DefaultFunctions.getNoUserId,
                onGetUserBinding,
                onSetUserBinding,
                onDeleteUserBinding
              }) {
    this.rbacManager = rbacManager
    this.createAuthzInput = createAuthzInput
    this.paginateUsers = paginateUsers
    this.getUserId = getUserId
    this.onGetUserBinding = onGetUserBinding
    this.onSetUserBinding = onSetUserBinding
    this.onDeleteUserBinding = onDeleteUserBinding
  }

  /**
   * A request handler providing an RBAC management endpoint for getting roles.
   *
   * @param {IncomingMessage} request the incoming HTTP request
   * @param {ServerResponse} response the outgoing HTTP response
   */
  async handleGetRoles(request, response) {
    if (checkMethod('GET', request, response)) {
      try {
        const authzInput = await this.createAuthzInput(request)
        const result = await this.rbacManager.getRoles(authzInput)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }

  /**
   * A request handler providing an RBAC management endpoint for getting a user-binding.
   *
   * @param {IncomingMessage} request the incoming HTTP request
   * @param {ServerResponse} response the outgoing HTTP response
   */
  async handleGetUserBinding(request, response) {
    if (checkMethod('GET', request, response)) {
      try {
        const authzInput = await this.createAuthzInput(request)
        const userId = await this.getUserId(authzInput, request)

        if (this.onGetUserBinding && !(await this.onGetUserBinding(userId, authzInput, request))) {
          throw new InvalidInputError(`Get role binding rejected`)
        }

        const result = await this.rbacManager.getUserBinding(userId, authzInput)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }

  /**
   * A request handler providing an RBAC management endpoint for deleting a user-binding.
   *
   * @param {IncomingMessage} request the incoming HTTP request
   * @param {ServerResponse} response the outgoing HTTP response
   */
  async handleDeleteUserBinding(request, response) {
    if (checkMethod('DELETE', request, response)) {
      try {
        const authzInput = await this.createAuthzInput(request)
        const userId = await this.getUserId(authzInput, request)

        if (this.onDeleteUserBinding && !(await this.onDeleteUserBinding(userId, authzInput, request))) {
          throw new InvalidInputError(`Delete role binding rejected`)
        }

        const result = await this.rbacManager.deleteUserBinding(userId, authzInput)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }

  /**
   * A request handler providing an RBAC management endpoint for upserting a user-binding.
   *
   * @param {IncomingMessage} request the incoming HTTP request
   * @param {ServerResponse} response the outgoing HTTP response
   */
  async handlePutUserBinding(request, response) {
    if (checkMethod('PUT', request, response)) {
      try {
        const authzInput = await this.createAuthzInput(request)
        const userId = await this.getUserId(authzInput, request)
        const body = await getBody(request)
        const roles = await sanitizeBinding(userId, fromJson(body), request)

        if (this.onSetUserBinding && !(await this.onSetUserBinding(userId, roles, authzInput, request))) {
          throw new InvalidInputError(`Set role binding rejected`)
        }

        const result = await this.rbacManager.setUserBinding(userId, roles, authzInput)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }

  /**
   * A request handler providing an RBAC management endpoint for listing user-bindings.
   *
   * @param {IncomingMessage} request the incoming HTTP request
   * @param {ServerResponse} response the outgoing HTTP response
   */
  async handleListUserBindings(request, response) {
    if (checkMethod('GET', request, response)) {
      try {
        const authzInput = await this.createAuthzInput(request)
        const result = await this.rbacManager.listUserBindings(authzInput)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }

  /**
   * A request handler providing an RBAC management endpoint for getting a list of user-bindings.
   *
   * @param {IncomingMessage} request the incoming HTTP request
   * @param {ServerResponse} response the outgoing HTTP response
   */
  async handleGetUserBindings(request, response) {
    if (checkMethod('GET', request, response)) {
      try {
        const authzInput = await this.createAuthzInput(request)
        const url = Url.parse(request.url)
        const page = new URLSearchParams(url.query).get('page')
        const usersResult = await this.paginateUsers(page, authzInput, request)
        const users = usersResult.result || []

        const result = await this.rbacManager.getUserBindings(users, authzInput)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result, page: usersResult.page}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }
}

export class Paginators {
  /**
   * @callback GetPagedDataCallback
   * @param {string} page
   * @param {RbacInputDocument} authzInput the input value for the authorization query
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
   * @param {RbacInputDocument} authzInput the input value for the authorization query
   * @param {IncomingMessage} request the incoming HTTP request
   * @returns {Promise<string[]>} a list if string user identifiers
   */

  /**
   * @callback GetTotalCountCallback
   * @param {RbacInputDocument} authzInput the input value for the authorization query
   * @param {IncomingMessage} request
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
    return async (page, authzInput, request) => {
      const index = page ? Math.max(parseInt(page), 1) : 1
      if (isNaN(index)) {
        throw new InvalidInputError("'page' is not a valid number")
      }

      let totalPages = undefined
      if (pageSize === 0) {
        totalPages = 1
      } else if (getTotalCount) {
        const totalCount = await getTotalCount(authzInput, request)
        totalPages = Math.ceil(totalCount / pageSize)
      }

      const offset = Math.max(index - 1, 0) * pageSize
      const result = await producer(offset, pageSize, authzInput, request)
      return {result, page: {index, total: totalPages}}
    }
  }
}

/**
 * A request handler providing an RBAC management endpoint.
 *
 * @callback RbacProxyHandler
 * @param {IncomingMessage} request the incoming HTTP request
 * @param {ServerResponse} response the outgoing HTTP response
 */

/**
 * Returns an RBAC proxy function for handling incoming HTTP requests to GET roles.
 *
 * @param {RbacManager} rbacManager
 * @param {CreateRbacAuthzInputCallback} createAuthzInput
 * @returns RbacProxyHandler
 */
export function proxyRbacGetRoles(rbacManager,
                                  {
                                    createAuthzInput = DefaultSessionInputStrategy.COOKIE
                                  } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput})
  return async (request, response) => {
    await proxy.handleGetRoles(request, response)
  }
}

/**
 * Returns an RBAC proxy function for handling incoming HTTP requests to GET a user-binding.
 *
 * @param {RbacManager} rbacManager
 * @param {CreateRbacAuthzInputCallback} createAuthzInput
 * @param {GetUserId} getUserId
 * @returns RbacProxyHandler
 */
export function proxyRbacGetUserBinding(rbacManager,
                                        {
                                          getUserId = DefaultFunctions.getUserIdFromPathParam,
                                          createAuthzInput = DefaultSessionInputStrategy.COOKIE,
                                        } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput, getUserId})
  return async (request, response) => {
    await proxy.handleGetUserBinding(request, response)
  }
}

/**
 * Returns an RBAC proxy function for handling incoming HTTP requests to PUT a user-binding.
 *
 * @param {RbacManager} rbacManager
 * @param {CreateRbacAuthzInputCallback} createAuthzInput
 * @param {GetUserId} getUserId
 * @returns RbacProxyHandler
 */
export function proxyRbacPutUserBinding(rbacManager,
                                        {
                                          getUserId = DefaultFunctions.getUserIdFromPathParam,
                                          createAuthzInput = DefaultSessionInputStrategy.COOKIE,
                                        } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput, getUserId})
  return async (request, response) => {
    await proxy.handlePutUserBinding(request, response)
  }
}

/**
 * Returns an RBAC proxy function for handling incoming HTTP requests to DELETE a user-binding.
 *
 * @param {RbacManager} rbacManager
 * @param {CreateRbacAuthzInputCallback} createAuthzInput
 * @param {GetUserId} getUserId
 * @returns RbacProxyHandler
 */
export function proxyRbacDeleteUserBinding(rbacManager,
                                           {
                                             getUserId = DefaultFunctions.getUserIdFromPathParam,
                                             createAuthzInput = DefaultSessionInputStrategy.COOKIE,
                                           } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput, getUserId})
  return async (request, response) => {
    await proxy.handleDeleteUserBinding(request, response)
  }
}

/**
 * Returns an RBAC proxy function for handling incoming HTTP requests to GET a list of all user-bindings.
 *
 * @param {RbacManager} rbacManager
 * @param {CreateRbacAuthzInputCallback} createAuthzInput
 * @returns RbacProxyHandler
 */
export function proxyRbacListUserBindings(rbacManager,
                                          {
                                            createAuthzInput = DefaultSessionInputStrategy.COOKIE,
                                          } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput})
  return async (request, response) => {
    await proxy.handleListUserBindings(request, response)
  }
}

/**
 * Returns an RBAC proxy function for handling incoming HTTP requests to GET a list of paginated user-bindings.
 *
 * @param {RbacManager} rbacManager
 * @param {PaginateRbacUsersCallback} paginateUsers
 * @param {CreateRbacAuthzInputCallback} createAuthzInput
 * @returns RbacProxyHandler
 */
export function proxyRbacGetUserBindings(rbacManager, paginateUsers,
                                         {
                                           createAuthzInput = DefaultSessionInputStrategy.COOKIE
                                         } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput, paginateUsers})
  return async (request, response) => {
    await proxy.handleGetUserBindings(request, response)
  }
}

/**
 * Returns an RBAC proxy function for handling incoming HTTP requests for RBAC management.
 *
 * @param rbacManager
 * @param createAuthzInput
 * @param paginateUsers
 * @param getUserId
 * @returns RbacProxyHandler
 */
export function proxyRbac(rbacManager,
                          {
                            createAuthzInput = DefaultSessionInputStrategy.COOKIE,
                            paginateUsers,
                            getUserId = DefaultFunctions.getUserIdFromPathParam
                          } = {}) {
  const proxy = new RbacProxy(rbacManager, {
    createAuthzInput,
    paginateUsers,
    getUserId
  })
  return async (request, response) => {
    const url = Url.parse(request.url)

    // GET /roles
    if (request.method === GET && pathEndsWith(url, ['roles'])) {
      await proxy.handleGetRoles(request, response)
    }
    // GET /user_bindings
    else if (request.method === GET && pathEndsWith(url, ['user_bindings'])) {
      if (paginateUsers) {
        await proxy.handleGetUserBindings(request, response)
      } else {
        await proxy.handleListUserBindings(request, response)
      }
    }
    // GET /user_bindings/:id
    else if (request.method === GET && pathEndsWith(url, ['user_bindings', '*'])) {
      await proxy.handleGetUserBinding(request, response)
    }
    // PUT /user_bindings/:id
    else if (request.method === PUT && pathEndsWith(url, ['user_bindings', '*'])) {
      await proxy.handlePutUserBinding(request, response)
    }
    // DELETE /user_bindings/:id
    else if (request.method === DELETE && pathEndsWith(url, ['user_bindings', '*'])) {
      await proxy.handleDeleteUserBinding(request, response)
    }
  }
}

function checkMethod(method, request, response) {
  if (request.method !== method) {
    response.writeHead(405, {'Content-Type': 'text/html'})
    response.end('Method Not Allowed!')
    return false
  }
  return true
}

function errorResponse(err, response, rbacManager) {
  rbacManager.styraRunClient.signalEvent(EventType.RBAC, {err})
  if (err instanceof StyraRunError) {
    response.writeHead(403, Headers.TEXT_CONTENT_TYPE)
    response.end('Forbidden')
  } else if (err instanceof InvalidInputError) {
    response.writeHead(400, Headers.TEXT_CONTENT_TYPE)
    response.end('Invalid request')
  } else {
    response.writeHead(500, Headers.TEXT_CONTENT_TYPE)
    response.end('Error')
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
