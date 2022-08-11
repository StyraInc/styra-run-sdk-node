import http from "node:http"
import serverSpy from "jasmine-http-server-spy"
import Url from "url"
import sdk, { DEFAULT_PREDICATE } from "../src/run-sdk.js"
import { clientRequest, withServer } from "./helpers.js"

describe("Roles can be fetched", () => {
  let httpSpy

  const port = 8082
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const sdkClient = sdk.New({
    url: 'http://placeholder',
    token: 'foobar'
  })
  sdkClient.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [
      {
        method: 'post',
        url: `/${basePath}/data/rbac/manage/allow`,
        handlerName: 'checkAuthzUrl'
      },
      {
        method: 'post',
        url: `/${basePath}/data/rbac/roles`,
        handlerName: 'getRolesUrl'
      }
    ])

    httpSpy.server.start(8082, done)
  })
  
  afterAll(function(done) {
    httpSpy.server.stop(done)
  })

  afterEach(function() {
    httpSpy.checkAuthzUrl.calls.reset();
    httpSpy.getRolesUrl.calls.reset();
  })

  const assertOkResponse = (roles) => {
    return async () => {
      const authzInput = {tenant: 'acmecorp', subject: 'alice'}

      httpSpy.checkAuthzUrl.and.returnValue({
        statusCode: 200,
        body: {
          result: true
        }
      })
  
      httpSpy.getRolesUrl.and.returnValue({
        statusCode: 200,
        body: {
          result: roles
        }
      })
  
      const server = http.createServer()
      server.addListener('request', sdkClient.manageRbac(() => { return authzInput }))
  
      await withServer(server, 8081, async () => {
        const {response, body} = await clientRequest(8081, 'GET', '/roles')
  
        expect(response.statusCode).toBe(200)
        expect(JSON.parse(body)).toEqual(roles)
        expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
          body: {input: authzInput}
        }))
        expect(httpSpy.getRolesUrl).toHaveBeenCalledWith(jasmine.objectContaining({
          body: {input: authzInput}
        }))
      })
    }
  }

  it("empty role list", assertOkResponse([]))
  it("role list with one entry", assertOkResponse(['foo']))
  it("role list with multiple entries", assertOkResponse(['ADMIN', 'EDITOR', 'VIEWER']))

  it("unauthorized", async () => {
    const authzInput = {tenant: 'acmecorp', subject: 'alice'}

    httpSpy.checkAuthzUrl.and.returnValue({
      statusCode: 200,
      body: {}
    })
  
    httpSpy.getRolesUrl.and.returnValue({
      statusCode: 200,
      body: {
        result: []
      }
    })

    const server = http.createServer()
    server.addListener('request', sdkClient.manageRbac(() => { return authzInput }))

    await withServer(server, 8081, async () => {
      const {response, body} = await clientRequest(8081, 'GET', '/roles')

      expect(response.statusCode).toBe(403)
      expect(body).toEqual('Forbidden')
      expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
        body: {input: authzInput}
      }))
      expect(httpSpy.getRolesUrl).toHaveBeenCalledTimes(0)
    })
  })
})

describe("Bindings can be fetched", () => {
  let httpSpy

  const port = 8082
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const sdkClient = sdk.New({
    url: 'http://placeholder',
    token: 'foobar',
    eventListeners: [(type, info) => {console.debug(type, info)}]
  })
  sdkClient.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [
      {
        method: 'post',
        url: `/${basePath}/data/rbac/manage/allow`,
        handlerName: 'checkAuthzUrl'
      },
      {
        method: 'get',
        url: `/${basePath}/data/rbac/user_bindings/acmecorp/alice`,
        handlerName: 'getAliceBindingUrl'
      },
      {
        method: 'get',
        url: `/${basePath}/data/rbac/user_bindings/acmecorp/bob`,
        handlerName: 'getBobBindingUrl'
      },
      {
        method: 'get',
        url: `/${basePath}/data/rbac/user_bindings/acmecorp/charles`,
        handlerName: 'getCharlesBindingUrl'
      }
    ])

    httpSpy.server.start(8082, done)
  })
  
  afterAll(function(done) {
    httpSpy.server.stop(done)
  })

  afterEach(function() {
    httpSpy.checkAuthzUrl.calls.reset();
    httpSpy.getAliceBindingUrl.calls.reset();
    httpSpy.getBobBindingUrl.calls.reset();
    httpSpy.getCharlesBindingUrl.calls.reset();
  })

  const assertOkResponse = (users, bindings, expectedBindings = undefined, page = undefined) => {
    return async () => {
      const authzInput = {tenant: 'acmecorp', subject: 'alice'}
      const notFoundResponseBody = {
        "code": "resource_not_found",
        "message": "Resource not found: document"
      }

      if (!expectedBindings) {
        expectedBindings = users.map((id) => {
          return {id, roles: bindings[id] ?? []}
        })
      }

      httpSpy.checkAuthzUrl.and.returnValue({
        statusCode: 200,
        body: {
          result: true
        }
      })
      
      if (bindings.hasOwnProperty('alice')) {
        httpSpy.getAliceBindingUrl.and.returnValue({
          statusCode: 200,
          body: {
            result: bindings['alice']
          }
        })
      } else {
        httpSpy.getAliceBindingUrl.and.returnValue({
          statusCode: 404,
          body: notFoundResponseBody
        })
      }

      if (bindings.hasOwnProperty('bob')) {
        httpSpy.getBobBindingUrl.and.returnValue({
          statusCode: 200,
          body: {
            result: bindings['bob']
          }
        })
      } else {
        httpSpy.getBobBindingUrl.and.returnValue({
          statusCode: 404,
          body: notFoundResponseBody
        })
      }
      
      if (bindings.hasOwnProperty('charles')) {
        httpSpy.getCharlesBindingUrl.and.returnValue({
          statusCode: 200,
          body: {
            result: bindings['charles']
          }
        })
      } else {
        httpSpy.getCharlesBindingUrl.and.returnValue({
          statusCode: 404,
          body: notFoundResponseBody
        })
      }
  
      const server = http.createServer()
      server.addListener('request', sdkClient.manageRbac(
        () => { return authzInput },
        (offset, limit) => { 
          if (limit === 0) {
            return users.slice(offset)
          }
          return users.slice(offset, offset + limit)
        },
        () => true,
        (page !== undefined ? 2 : 0)))
  
      await withServer(server, 8081, async () => {
        const {response, body} = await clientRequest(8081, 'GET', '/user_bindings' + (page !== undefined ? `?page=${page}` : ''))
  
        expect(response.statusCode).toBe(200)
        expect(JSON.parse(body)).toEqual(expectedBindings)
        expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
          body: {input: authzInput}
        }))

        const expectedCalls = expectedBindings.map((expectedBinding) => expectedBinding.id)

        expect(httpSpy.getAliceBindingUrl).toHaveBeenCalledTimes(expectedCalls.includes('alice') ? 1 : 0)
        expect(httpSpy.getBobBindingUrl).toHaveBeenCalledTimes(expectedCalls.includes('bob') ? 1 : 0)
        expect(httpSpy.getCharlesBindingUrl).toHaveBeenCalledTimes(expectedCalls.includes('charles') ? 1 : 0)
      })
    }
  }

  it("no users", assertOkResponse([], {}))
  it("users with bindings", assertOkResponse(['alice', 'bob', 'charles'], {
    alice: ['ADMIN'],
    bob: [],
    charles: ['foo', 'bar'],
  }))
  it("users with missing bindings", assertOkResponse(['alice', 'bob', 'charles'], {
    alice: ['ADMIN'],
    charles: ['foo', 'bar']
  }))
  it("less users than bindings", assertOkResponse(['bob'], {
    alice: ['ADMIN'],
    bob: ['Viewer'],
    charles: ['foo', 'bar']
  }))
  
  it("bindings page 1", assertOkResponse(
    ['alice', 'bob', 'charles'], 
    {
      alice: ['ADMIN'],
      bob: [],
      charles: ['foo', 'bar'],
    }, 
    [{id: 'alice', roles: ['ADMIN']}, {id: 'bob', roles: []}], 
    1))
  it("bindings page 2", assertOkResponse(
    ['alice', 'bob', 'charles'], 
    {
      alice: ['ADMIN'],
      bob: [],
      charles: ['foo', 'bar'],
    }, 
    [{id: 'charles', roles: ['foo', 'bar']}], 
    2))
  // requesting page 0 should return page 1
  it("bindings page 0", assertOkResponse(
    ['alice', 'bob', 'charles'], 
    {
      alice: ['ADMIN'],
      bob: [],
      charles: ['foo', 'bar'],
    }, 
    [{id: 'alice', roles: ['ADMIN']}, {id: 'bob', roles: []}], 
    0))
  it("bindings page 500", assertOkResponse(
    ['alice', 'bob', 'charles'], 
    {
      alice: ['ADMIN'],
      bob: [],
      charles: ['foo', 'bar'],
    }, 
    [], 
    500))

  it("unauthorized", async () => {
    const authzInput = {tenant: 'acmecorp', subject: 'alice'}

    httpSpy.checkAuthzUrl.and.returnValue({
      statusCode: 200,
      body: {}
    })
  
    httpSpy.getAliceBindingUrl.and.returnValue({
      statusCode: 200,
      body: {
        result: []
      }
    })

    const server = http.createServer()
    server.addListener('request', sdkClient.manageRbac(() => { return authzInput }))

    await withServer(server, 8081, async () => {
      const {response, body} = await clientRequest(8081, 'GET', '/user_bindings')

      expect(response.statusCode).toBe(403)
      expect(body).toEqual('Forbidden')
      expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
        body: {input: authzInput}
      }))
      expect(httpSpy.getAliceBindingUrl).toHaveBeenCalledTimes(0)
    })
  })
})

describe("Bindings can be upserted", () => {
  let httpSpy

  const port = 8082
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const sdkClient = sdk.New({
    url: 'http://placeholder',
    token: 'foobar',
    eventListeners: [(type, info) => {console.debug(type, info)}]
  })
  sdkClient.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [
      {
        method: 'post',
        url: `/${basePath}/data/rbac/manage/allow`,
        handlerName: 'checkAuthzUrl'
      },
      {
        method: 'put',
        url: `/${basePath}/data/rbac/user_bindings/acmecorp/alice`,
        handlerName: 'putAliceBindingUrl'
      },
      {
        method: 'put',
        url: `/${basePath}/data/rbac/user_bindings/acmecorp/bob`,
        handlerName: 'putBobBindingUrl'
      },
      {
        method: 'put',
        url: `/${basePath}/data/rbac/user_bindings/acmecorp/charles`,
        handlerName: 'putCharlesBindingUrl'
      }
    ])

    httpSpy.server.start(8082, done)
  })
  
  afterAll(function(done) {
    httpSpy.server.stop(done)
  })

  afterEach(function() {
    httpSpy.checkAuthzUrl.calls.reset();
    httpSpy.putAliceBindingUrl.calls.reset();
    httpSpy.putBobBindingUrl.calls.reset();
    httpSpy.putCharlesBindingUrl.calls.reset();
  })
  
  it("ok", () => {
    return async () => {
      const authzInput = {tenant: 'acmecorp', subject: 'alice'}
      const roles = ['do', 're', 'mi']

      httpSpy.checkAuthzUrl.and.returnValue({
        statusCode: 200,
        body: {
          result: true
        }
      })

      httpSpy.putAliceBindingUrl.and.returnValue({
        statusCode: 200,
        body: {}
      })
  
      const server = http.createServer()
      server.addListener('request', sdkClient.manageRbac(
        () => { return authzInput }))
  
      await withServer(server, 8081, async () => {
        const {response, body} = await clientRequest(8081, 'PUT', '/user_bindings/alice', JSON.stringify(roles))
  
        expect(response.statusCode).toBe(200)
        expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
          body: {input: authzInput}
        }))

        expect(httpSpy.putAliceBindingUrl).toHaveBeenCalledWith(jasmine.objectContaining({
          body: roles
        }))
        expect(httpSpy.putBobBindingUrl).toHaveBeenCalledTimes(0)
        expect(httpSpy.putCharlesBindingUrl).toHaveBeenCalledTimes(0)
      })
    }
  })

  const assertErrorResponse = (statusCode) => {
    return async () => {
      const authzInput = {tenant: 'acmecorp', subject: 'alice'}
      const roles = ['do', 're', 'mi']
  
      httpSpy.checkAuthzUrl.and.returnValue({
        statusCode: 200,
        body: {
          result: true
        }
      })
  
      httpSpy.putAliceBindingUrl.and.returnValue({
        statusCode: statusCode
      })
  
      const server = http.createServer()
      server.addListener('request', sdkClient.manageRbac(
        () => { return authzInput }))
  
      await withServer(server, 8081, async () => {
        const {response} = await clientRequest(8081, 'PUT', '/user_bindings/alice', JSON.stringify(roles))
  
        expect(response.statusCode).toBe(500)
        expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
          body: {input: authzInput}
        }))
  
        expect(httpSpy.putAliceBindingUrl).toHaveBeenCalledWith(jasmine.objectContaining({
          body: roles
        }))
        expect(httpSpy.putBobBindingUrl).toHaveBeenCalledTimes(0)
        expect(httpSpy.putCharlesBindingUrl).toHaveBeenCalledTimes(0)
      })
    }
  }

  it("not found", assertErrorResponse(400))
  it("not found", assertErrorResponse(404))
  it("not found", assertErrorResponse(500))

  it("unauthorized", async () => {
    const authzInput = {tenant: 'acmecorp', subject: 'alice'}

    httpSpy.checkAuthzUrl.and.returnValue({
      statusCode: 200,
      body: {}
    })
  
    httpSpy.putAliceBindingUrl.and.returnValue({
      statusCode: 200,
      body: {
        result: []
      }
    })

    const server = http.createServer()
    server.addListener('request', sdkClient.manageRbac(() => { return authzInput }))

    await withServer(server, 8081, async () => {
      const {response, body} = await clientRequest(8081, 'PUT', '/user_bindings/alice', 
        JSON.stringify(['foo']))

      expect(response.statusCode).toBe(403)
      expect(body).toEqual('Forbidden')
      expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
        body: {input: authzInput}
      }))
      expect(httpSpy.putAliceBindingUrl).toHaveBeenCalledTimes(0)
    })
  })
})