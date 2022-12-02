import Url from "url";
import {InvalidInputError, StyraRunError} from "./errors.js";
import {toJson, Headers, getBody, fromJson, pathEndsWith} from "./helpers.js";
import {EventType} from "./rbac-management.js";
import {DefaultSessionInputStrategy} from "./session.js";
import {Method} from "./types.js"

const {GET, PUT, DELETE} = Method

export const DefaultFunctions = {
  getUserId: (request) => {
    const path = Url.parse(request.url).path.split('/')
    return path[path.length - 1]
  },
}

export default class RbacProxy {
  constructor(rbacManager,
              {
                createAuthzInput,
                paginateUsers,
                getUserId = () => null
              }) {
    this.rbacManager = rbacManager
    this.createAuthzInput = createAuthzInput
    this.paginateUsers = paginateUsers
    this.getUserId = getUserId
  }

  async handleGetRoles(request, response) {
    if (checkMethod('GET', request, response)) {
      try {
        const input = await this.createAuthzInput(request)
        const result = await this.rbacManager.getRoles(input)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }

  async handleGetUserBinding(request, response) {
    if (checkMethod('GET', request, response)) {
      try {
        const input = await this.createAuthzInput(request)
        const userId = await this.getUserId(request)
        const result = await this.rbacManager.getUserBinding(userId, input)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }

  async handleDeleteUserBinding(request, response) {
    if (checkMethod('DELETE', request, response)) {
      try {
        const input = await this.createAuthzInput(request)
        const userId = await this.getUserId(request)
        const result = await this.rbacManager.deleteUserBinding(userId, input)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }

  async handlePutUserBinding(request, response) {
    if (checkMethod('PUT', request, response)) {
      try {
        const input = await this.createAuthzInput(request)
        const userId = await this.getUserId(request)
        const body = await getBody(request)
        const roles = await sanitizeBinding(userId, fromJson(body), request)

        const result = await this.rbacManager.setUserBinding(userId, roles, input)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }

  async handleListUserBindings(request, response) {
    if (checkMethod('GET', request, response)) {
      try {
        const input = await this.createAuthzInput(request)
        const result = await this.rbacManager.listUserBindings(input)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }

  async handleGetUserBindings(request, response) {
    if (checkMethod('GET', request, response)) {
      try {
        const input = await this.createAuthzInput(request)
        const url = Url.parse(request.url)
        const page = new URLSearchParams(url.query).get('page')
        const usersResult = await this.paginateUsers(page, request)
        const users = usersResult.result || []

        const result = await this.rbacManager.getUserBindings(users, input)

        response.writeHead(200, Headers.JSON_CONTENT_TYPE)
        response.end(toJson({result, page: usersResult.page}))
      } catch (err) {
        errorResponse(err, response, this.rbacManager)
      }
    }
  }
}

export function proxyRbacGetRoles(rbacManager,
                                  {
                                    createAuthzInput = DefaultSessionInputStrategy.COOKIE
                                  } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput})
  return async (request, response) => {
    await proxy.handleGetRoles(request, response)
  }
}

export function proxyRbacGetUserBinding(rbacManager,
                                        {
                                          getUserId = DefaultFunctions.getUserId,
                                          createAuthzInput = DefaultSessionInputStrategy.COOKIE,
                                        } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput, getUserId})
  return async (request, response) => {
    await proxy.handleGetUserBinding(request, response)
  }
}

export function proxyRbacPutUserBinding(rbacManager,
                                        {
                                          getUserId = DefaultFunctions.getUserId,
                                          createAuthzInput = DefaultSessionInputStrategy.COOKIE,
                                        } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput, getUserId})
  return async (request, response) => {
    await proxy.handlePutUserBinding(request, response)
  }
}

export function proxyRbacDeleteUserBinding(rbacManager,
                                           {
                                             getUserId = DefaultFunctions.getUserId,
                                             createAuthzInput = DefaultSessionInputStrategy.COOKIE,
                                           } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput, getUserId})
  return async (request, response) => {
    await proxy.handleDeleteUserBinding(request, response)
  }
}

export function proxyRbacListUserBindings(rbacManager,
                                          {
                                            createAuthzInput = DefaultSessionInputStrategy.COOKIE,
                                          } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput})
  return async (request, response) => {
    await proxy.handleListUserBindings(request, response)
  }
}

export function proxyRbacGetUserBindings(rbacManager, paginateUsers,
                                         {
                                           createAuthzInput = DefaultSessionInputStrategy.COOKIE
                                         } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput, paginateUsers})
  return async (request, response) => {
    await proxy.handleGetUserBindings(request, response)
  }
}

export function proxyRbac(rbacManager,
                          {
                            createAuthzInput = DefaultSessionInputStrategy.COOKIE,
                            paginateUsers,
                            getUserId = DefaultFunctions.getUserId
                          } = {}) {
  const proxy = new RbacProxy(rbacManager, {createAuthzInput, paginateUsers, getUserId})
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
