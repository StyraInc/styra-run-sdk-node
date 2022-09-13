import http from "node:http"
import serverSpy from "jasmine-http-server-spy"
import Url from "url"
import StyraRun, {Paginators} from "../src/run-sdk.js"
import {clientRequest, withServer} from "./helpers.js"

describe("Roles can be fetched", () => {
  let httpSpy

  const port = 8082
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const sdkClient = StyraRun('http://placeholder', 'foobar')
  sdkClient.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(async () => {
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

    await httpSpy.server.start(8082)
  })

  afterAll(async () => {
    await httpSpy.server.stop()
  })

  afterEach(function () {
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
      server.addListener('request', sdkClient.manageRbac({
        createAuthzInput: () => {
          return authzInput
        }
      }))

      await withServer(server, 8081, async () => {
        const {response, body} = await clientRequest(8081, 'GET', '/roles')

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(body)).toEqual({result: roles})
        expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
          body: {input: authzInput}
        }))
        expect(httpSpy.getRolesUrl).toHaveBeenCalledTimes(1)
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
    server.addListener('request', sdkClient.manageRbac({
      createAuthzInput: () => {
        return authzInput
      }
    }))

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
  const sdkClient = StyraRun('http://placeholder', 'foobar')
  sdkClient.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(async () => {
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

    await httpSpy.server.start(8082)
  })

  afterAll(async () => {
    await httpSpy.server.stop()
  })

  afterEach(function () {
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

      const userProducer = (offset, limit, _) => {
        if (limit === 0) {
          return users.slice(offset)
        }
        return users.slice(offset, offset + limit)
      }

      const server = http.createServer()
      server.addListener('request', sdkClient.manageRbac(
        {
          createAuthzInput: () => {
            return authzInput
          },
          getUsers: Paginators.makeIndexedPaginator((page !== undefined ? 2 : 0), userProducer)
        }))

      await withServer(server, 8081, async () => {
        const {
          response,
          body
        } = await clientRequest(8081, 'GET', '/user_bindings' + (page !== undefined ? `?page=${page}` : ''))

        expect(response.statusCode).toBe(200)
        expect(JSON.parse(body).result).toEqual(expectedBindings)
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
    server.addListener('request', sdkClient.manageRbac({
      createAuthzInput: () => {
        return authzInput
      }
    }))

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

describe("Individual bindings can be fetched", () => {
  let httpSpy

  const port = 8083
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const sdkClient = StyraRun('http://placeholder', 'foobar')
  sdkClient.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(async () => {
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

    await httpSpy.server.start(port)
  })

  afterAll(async () => {
    await httpSpy.server.stop()
  })

  afterEach(function () {
    httpSpy.checkAuthzUrl.calls.reset();
    httpSpy.getAliceBindingUrl.calls.reset();
    httpSpy.getBobBindingUrl.calls.reset();
    httpSpy.getCharlesBindingUrl.calls.reset();
  })

  it("ok", async () => {
    const expectedRoleBinding = ['foo', 'bar']
    const authzInput = {tenant: 'acmecorp', subject: 'alice'}

    httpSpy.checkAuthzUrl.and.returnValue({
      statusCode: 200,
      body: {
        result: true
      }
    })

    httpSpy.getAliceBindingUrl.and.returnValue({
      statusCode: 200,
      body: {
        result: ['foo', 'bar']
      }
    })

    const server = http.createServer()
    server.addListener('request', sdkClient.manageRbac(
      {
        createAuthzInput: () => {
          return authzInput
        }
      }))

    await withServer(server, 8081, async () => {
      const {response, body} = await clientRequest(8081, 'GET', '/user_bindings/alice')

      expect(response.statusCode).toBe(200)
      expect(JSON.parse(body)).toEqual({result: expectedRoleBinding})
      expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
        body: {input: authzInput}
      }))

      expect(httpSpy.getAliceBindingUrl).toHaveBeenCalledTimes(1)
      expect(httpSpy.getBobBindingUrl).toHaveBeenCalledTimes(0)
      expect(httpSpy.getCharlesBindingUrl).toHaveBeenCalledTimes(0)
    })
  })

  const assertErrorResponse = (statusCode) => {
    return async () => {
      const authzInput = {tenant: 'acmecorp', subject: 'alice'}

      httpSpy.checkAuthzUrl.and.returnValue({
        statusCode: 200,
        body: {
          result: true
        }
      })

      httpSpy.getBobBindingUrl.and.returnValue({
        statusCode: statusCode,
        body: {
          result: ['alsiuefhaislu']
        }
      })

      const server = http.createServer()
      server.addListener('request', sdkClient.manageRbac(
        {
          createAuthzInput: () => {
            return authzInput
          }
        }))

      await withServer(server, 8081, async () => {
        const {response, body} = await clientRequest(8081, 'GET', '/user_bindings/bob')

        expect(response.statusCode).toBe(500)
        expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
          body: {input: authzInput}
        }))

        expect(httpSpy.getAliceBindingUrl).toHaveBeenCalledTimes(0)
        expect(httpSpy.getBobBindingUrl).toHaveBeenCalledTimes(1)
        expect(httpSpy.getCharlesBindingUrl).toHaveBeenCalledTimes(0)
      })
    }
  }

  // it("not found", assertErrorResponse(400))
  it("not found", assertErrorResponse(404))
  // it("not found", assertErrorResponse(500))

  it("unauthorized", async () => {
    const authzInput = {tenant: 'acmecorp', subject: 'alice'}

    httpSpy.checkAuthzUrl.and.returnValue({
      statusCode: 200,
      body: {}
    })

    httpSpy.getAliceBindingUrl.and.returnValue({
      statusCode: 200
    })

    const server = http.createServer()
    server.addListener('request', sdkClient.manageRbac({
      createAuthzInput: () => {
        return authzInput
      }
    }))

    await withServer(server, 8081, async () => {
      const {response, body} = await clientRequest(8081, 'GET', '/user_bindings/alice',
        JSON.stringify(['foo']))

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
  const sdkClient = StyraRun('http://placeholder', 'foobar')
  sdkClient.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(async () => {
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

    await httpSpy.server.start(8082)
  })

  afterAll(async () => {
    await httpSpy.server.stop()
  })

  afterEach(function () {
    httpSpy.checkAuthzUrl.calls.reset();
    httpSpy.putAliceBindingUrl.calls.reset();
    httpSpy.putBobBindingUrl.calls.reset();
    httpSpy.putCharlesBindingUrl.calls.reset();
  })

  it("ok", async () => {
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
      {
        createAuthzInput: () => {
          return authzInput
        }
      }))

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
        {
          createAuthzInput: () => {
            return authzInput
          }
        }))

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
    server.addListener('request', sdkClient.manageRbac({
      createAuthzInput: () => {
        return authzInput
      }
    }))

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

describe("Bindings can be deleted", () => {
  let httpSpy

  const port = 8082
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const sdkClient = StyraRun('http://placeholder', 'foobar')
  sdkClient.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(async () => {
    httpSpy = serverSpy.createSpyObj('mockServer', [
      {
        method: 'post',
        url: `/${basePath}/data/rbac/manage/allow`,
        handlerName: 'checkAuthzUrl'
      },
      {
        method: 'delete',
        url: `/${basePath}/data/rbac/user_bindings/acmecorp/alice`,
        handlerName: 'deleteAliceBindingUrl'
      },
      {
        method: 'delete',
        url: `/${basePath}/data/rbac/user_bindings/acmecorp/bob`,
        handlerName: 'deleteBobBindingUrl'
      },
      {
        method: 'delete',
        url: `/${basePath}/data/rbac/user_bindings/acmecorp/charles`,
        handlerName: 'deleteCharlesBindingUrl'
      }
    ])

    await httpSpy.server.start(8082)
  })

  afterAll(async () => {
    await httpSpy.server.stop()
  })

  afterEach(function () {
    httpSpy.checkAuthzUrl.calls.reset();
    httpSpy.deleteAliceBindingUrl.calls.reset();
    httpSpy.deleteBobBindingUrl.calls.reset();
    httpSpy.deleteCharlesBindingUrl.calls.reset();
  })

  it("ok", async () => {
    const authzInput = {tenant: 'acmecorp', subject: 'alice'}

    httpSpy.checkAuthzUrl.and.returnValue({
      statusCode: 200,
      body: {
        result: true
      }
    })

    httpSpy.deleteAliceBindingUrl.and.returnValue({
      statusCode: 200,
      body: {}
    })

    const server = http.createServer()
    server.addListener('request', sdkClient.manageRbac(
      {
        createAuthzInput: () => {
          return authzInput
        }
      }))

    await withServer(server, 8081, async () => {
      const {response} = await clientRequest(8081, 'DELETE', '/user_bindings/alice')

      expect(response.statusCode).toBe(200)
      expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
        body: {input: authzInput}
      }))

      expect(httpSpy.deleteAliceBindingUrl).toHaveBeenCalledTimes(1)
      expect(httpSpy.deleteBobBindingUrl).toHaveBeenCalledTimes(0)
      expect(httpSpy.deleteCharlesBindingUrl).toHaveBeenCalledTimes(0)
    })
  })

  const assertErrorResponse = (statusCode) => {
    return async () => {
      const authzInput = {tenant: 'acmecorp', subject: 'alice'}

      httpSpy.checkAuthzUrl.and.returnValue({
        statusCode: 200,
        body: {
          result: true
        }
      })

      httpSpy.deleteAliceBindingUrl.and.returnValue({
        statusCode: statusCode
      })

      const server = http.createServer()
      server.addListener('request', sdkClient.manageRbac(
        {
          createAuthzInput: () => {
            return authzInput
          }
        }))

      await withServer(server, 8081, async () => {
        const {response} = await clientRequest(8081, 'DELETE', '/user_bindings/alice')

        expect(response.statusCode).toBe(500)
        expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
          body: {input: authzInput}
        }))

        expect(httpSpy.deleteAliceBindingUrl).toHaveBeenCalledTimes(1)
        expect(httpSpy.deleteBobBindingUrl).toHaveBeenCalledTimes(0)
        expect(httpSpy.deleteCharlesBindingUrl).toHaveBeenCalledTimes(0)
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

    httpSpy.deleteAliceBindingUrl.and.returnValue({
      statusCode: 200
    })

    const server = http.createServer()
    server.addListener('request', sdkClient.manageRbac({
      createAuthzInput: () => {
        return authzInput
      }
    }))

    await withServer(server, 8081, async () => {
      const {response, body} = await clientRequest(8081, 'DELETE', '/user_bindings/alice',
        JSON.stringify(['foo']))

      expect(response.statusCode).toBe(403)
      expect(body).toEqual('Forbidden')
      expect(httpSpy.checkAuthzUrl).toHaveBeenCalledWith(jasmine.objectContaining({
        body: {input: authzInput}
      }))
      expect(httpSpy.deleteAliceBindingUrl).toHaveBeenCalledTimes(0)
    })
  })
})

describe('indexed paginator', () => {
  it('can translate page index to offset and limit', () => {
    const assertOffsetAndLimit = (pageSize, index, expectedOffset) => {
      const expectedLimit = pageSize
      let appliedOffset
      let appliedLimit

      const paginator = Paginators.makeIndexedPaginator(pageSize, async (offset, limit, _) => {
        appliedOffset = offset
        appliedLimit = limit
        return []
      })

      paginator(`${index}`, undefined)

      expect(appliedOffset).toBe(expectedOffset)
      expect(appliedLimit).toBe(expectedLimit)
    }

    assertOffsetAndLimit(0, 0, 0)
    assertOffsetAndLimit(0, 1, 0)
    assertOffsetAndLimit(0, 10, 0)
    assertOffsetAndLimit(1, 0, 0)
    assertOffsetAndLimit(1, 1, 0)
    assertOffsetAndLimit(1, 2, 1)
    assertOffsetAndLimit(1, 10, 9)
    assertOffsetAndLimit(10, 0, 0)
    assertOffsetAndLimit(10, 1, 0)
    assertOffsetAndLimit(10, 2, 10)
    assertOffsetAndLimit(10, 10, 90)
  })

  it('returned serialized page object has expected meta', () => {
    const assertResult = async (pageSize, getCount, expectedPageCount) => {
      const index = 1
      const paginator = Paginators.makeIndexedPaginator(pageSize, async (offset, limit, _) => {
        return ['alice', 'bob']
      }, getCount)

      const result = await paginator(`${index}`, undefined)

      expect(result.result).toEqual(['alice', 'bob'])

      expect(result.page?.index).toBe(index)
      expect(result.page?.of).toBe(expectedPageCount)
    }

    assertResult(0, undefined, 1)
    assertResult(0, () => 0, 1)
    assertResult(1, () => 10, 10)
    assertResult(2, () => 10, 5)
  })
})