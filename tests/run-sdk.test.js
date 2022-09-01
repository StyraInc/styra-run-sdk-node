import http from "node:http"
import Url from "url"
import serverSpy from "jasmine-http-server-spy"
import StyraRun, { defaultPredicate } from "../src/run-sdk.js"
import { StyraRunAssertionError } from "../src/errors.js"
import { clientRequest, withServer } from "./helpers.js"

describe("Query", () => {
  let httpSpy

  const port = 8082
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const path = 'foo/allowed'
  const client = StyraRun('http://placeholder', 'foobar')
  client.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [
      {
        method: 'post',
        url: `/${basePath}/data/foo/allowed`,
        handlerName: 'getMockedUrl'
      }
    ])

    httpSpy.server.start(8082, done)
  })
  
  afterAll(function(done) {
    httpSpy.server.stop(done)
  })

  afterEach(function() {
    httpSpy.getMockedUrl.calls.reset();
  })

  it("Successful, no input", async () => {
    const expectedResult = {
      result: true
    }
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: expectedResult
    })

    const result = await client.query(path)
    expect(result).toEqual(expectedResult)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {}
    }));
  })

  it("Successful, object input", async () => {
    const expectedResult = {result: true}
    const input = {foo: "bar"}
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: expectedResult
    })

    const result = await client.query(path, input)
    expect(result).toEqual(expectedResult)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {input}
    }));
  })

  it("Successful, primitive input", async () => {
    const expectedResult = {result: true}
    const input = "foo bar"
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: expectedResult
    })

    const result = await client.query(path, input)
    expect(result).toEqual(expectedResult)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {input}
    }));
  })

  it("Successful, empty response", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200
    })

    const result = await client.query(path)
    expect(result).toEqual({})
  })

  it("400 response", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 400,
      body: "foo bar"
    })

    const input = {foo: "bar"}

    // Cannot use expectAsync().toBeRejectedWith(), as it doesn't allow us to assert error properties other than message
    try {
      const result = await client.query(path, input)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.name).toBe('StyraRunError')
      expect(err.message).toBe('Query failed: Unexpected status code: 400')
      expect(err.cause.name).toBe('StyraRunHttpError')
      expect(err.cause.message).toBe('Unexpected status code: 400')
      expect(err.cause.statusCode).toBe(400)
      expect(err.cause.attempts).toBe(1)
      expect(err.cause.body).toBe("foo bar")
    }
  })

  it("Invalid response json body", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: "foo bar"
    })

    const input = {foo: "bar"}

    try {
      const result = await client.query(path, input)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.name).toBe('StyraRunError')
      expect(err.message).toBe('Query failed: Invalid JSON')
      expect(err.cause.message).toBe('Invalid JSON')
    }
  })
})

describe("Batched Query", () => {
  let httpSpy

  const port = 8082
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const client = StyraRun('http://placeholder', 'foobar')
  client.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [{
        method: 'post',
        url: `/${basePath}/data_batch`,
        handlerName: 'getMockedUrl'
      }
    ])
    httpSpy.server.start(8082, done)
  })
  
  afterAll(function(done) {
    httpSpy.server.stop(done)
  })

  afterEach(function() {
    httpSpy.getMockedUrl.calls.reset();
  })

  it("Successful, no global input", async () => {
    const expectedResult = [
      {check: {result: true}},
      {check: {}},
      {check: {result: 1337}}
    ]
    const items = [
      {path: '/foo'},
      {path: '/bar', input: {subject: 'admin'}},
      {path: '/baz', input: 42}
    ]

    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: {result: expectedResult}
    })

    const result = await client.batchQuery(items)
    expect(result).toEqual(expectedResult)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {items}
    }));
  })

  it("Successful, max allowed items reached", async () => {
    const client = StyraRun('http://placeholder', 'foobar', {
      batchMaxItems: 3
    })
    client.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

    const items = [
      {path: '/do'},
      {path: '/re', input: {subject: 'admin'}},
      {path: '/mi', input: 42},
      {path: '/fa', input: 1337}
    ]
    const expectedResult = [
      {check: {result: 1}},
      {check: {result: 2}},
      {check: {result: 3}},
      {check: {result: 4}}
    ]

    httpSpy.getMockedUrl.and.callFake((req) => {
      if (req.body.items[0].path === '/do') {
        return {
          statusCode: 200,
          body: {result: expectedResult.slice(0, 3)}
        }
      } else {
        return {
          statusCode: 200,
          body: {result: expectedResult.slice(3)}
        }
      }
    })

    const result = await client.batchQuery(items)
    expect(result).toEqual(expectedResult)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {items: items.slice(0, 3)}
    }));
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {items: items.slice(3)}
    }));
  })

  it("Successful, with global input", async () => {
    const expectedResult = [
      {check: {result: true}},
      {check: {}},
      {check: {result: 1337}}
    ]
    const items = [
      {path: '/foo'},
      {path: '/bar', input: {subject: 'admin'}},
      {path: '/baz', input: 42}
    ]
    const input = {
      foo: "bar"
    }

    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: {result: expectedResult}
    })

    const result = await client.batchQuery(items, input)
    expect(result).toEqual(expectedResult)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {items, input}
    }));
  })

  it("Successful, empty response", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: [] // jasmine-http won't allow us to define no body
    })

    const result = await client.batchQuery([])
    expect(result).toEqual([])
  })

  it("400 response", async () => {
    const items = [
      {path: '/foo'},
      {path: '/bar', input: {subject: 'admin'}},
      {path: '/baz', input: 42}
    ]
    const input = {
      foo: "bar"
    }

    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 400,
      body: "foo bar"
    })

    try {
      const result = await client.batchQuery(items, input)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.message).toBe('Batched check failed: Unexpected status code: 400')
      expect(err.cause.name).toBe('StyraRunHttpError')
      expect(err.cause.message).toBe('Unexpected status code: 400')
      expect(err.cause.statusCode).toBe(400)
      expect(err.cause.attempts).toBe(1)
      expect(err.cause.body).toBe("foo bar")
    }
  })

  it("Invalid response json body", async () => {
    const items = [
      {path: '/foo'},
      {path: '/bar', input: {subject: 'admin'}},
      {path: '/baz', input: 42}
    ]
    const input = {
      foo: "bar"
    }

    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: "foo bar"
    })

    // Cannot use expectAsync().toBeRejectedWith(), as it doesn't allow us to assert error properties other than message
    try {
      const result = await client.batchQuery(items, input)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.message).toBe('Batched check failed: Invalid JSON')
      expect(err.cause).toBeDefined()
      expect(err.cause.message).toBe('Invalid JSON')
    }
  })
})

describe("Check", () => {
  let httpSpy

  const port = 8082
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const path = 'foo/allowed'
  const client = StyraRun('http://placeholder', 'foobar')
  client.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [{
        method: 'post',
        url: `/${basePath}/data/${path}`,
        handlerName: 'getMockedUrl'
      }
    ])
    httpSpy.server.start(8082, done)
  })
  
  afterAll(function(done) {
    httpSpy.server.stop(done)
  })

  afterEach(function() {
    httpSpy.getMockedUrl.calls.reset();
  })

  it("Successful, no input", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: {result: true}
    })


    await expectAsync(client.check(path)).toBeResolvedTo(true)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {}
    }));
  })

  it("Successful, with input", async () => {
    const expectedResult = {result: true}
    const input = {foo: "bar"}
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: expectedResult
    })

    await expectAsync(client.check(path, input)).toBeResolvedTo(true)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {input}
    }));
  })

  it("Rejected", async () => {
    const expectedResult = {result: false}
    const input = {foo: "bar"}
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: expectedResult
    })

    await expectAsync(client.check(path, input))
      .toBeResolvedTo(false)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {input}
    }));
  })

  it("Error response", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 500,
      body: 'some error happened'
    })

    const input = {foo: "bar"}

    // Cannot use expectAsync().toBeRejectedWith(), as it doesn't allow us to assert error properties other than message
    try {
      const result = await client.check(path, input)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.name).toBe('StyraRunError')
      expect(err.message).toBe('Check failed: Query failed: Unexpected status code: 500')
      expect(err.cause.name).toBe('StyraRunError')
      expect(err.cause.message).toBe('Query failed: Unexpected status code: 500')
      expect(err.cause.cause.name).toBe('StyraRunHttpError')
      expect(err.cause.cause.message).toBe('Unexpected status code: 500')
      expect(err.cause.cause.statusCode).toBe(500)
      expect(err.cause.cause.attempts).toBe(1)
      expect(err.cause.cause.body).toBe('some error happened')
    }
  })
})

describe("Assert", () => {
  let httpSpy

  const port = 8082
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const path = 'foo/allowed'
  const client = StyraRun('http://placeholder', 'foobar')
  client.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [{
        method: 'post',
        url: `/${basePath}/data/${path}`,
        handlerName: 'getMockedUrl'
      }
    ])
    httpSpy.server.start(8082, done)
  })
  
  afterAll(function(done) {
    httpSpy.server.stop(done)
  })

  afterEach(function() {
    httpSpy.getMockedUrl.calls.reset();
  })

  it("Successful, no input", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: {result: true}
    })


    await expectAsync(client.assert(path)).toBeResolved()
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {}
    }));
  })

  it("Successful, with input", async () => {
    const expectedResult = {result: true}
    const input = {foo: "bar"}
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: expectedResult
    })

    await expectAsync(client.assert(path, input)).toBeResolved()
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {input}
    }));
  })

  it("Successful, with input and passthrough data", async () => {
    const expectedResult = {result: true}
    const input = {foo: "bar"}
    const data = {do: "re"}
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: expectedResult
    })

    await expectAsync(client.assertAndReturn(data, path, input))
      .toBeResolvedTo(data)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {input}
    }));
  })

  it("Rejected", async () => {
    const expectedResult = {result: false}
    const input = {foo: "bar"}
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: expectedResult
    })

    await expectAsync(client.assert(path, input))
      .toBeRejectedWith(new StyraRunAssertionError())
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {input}
    }));
  })

  it("Error response", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 500,
      body: 'some error happened'
    })

    const input = {foo: "bar"}

    // Cannot use expectAsync().toBeRejectedWith(), as it doesn't allow us to assert error properties other than message
    try {
      const result = await client.assert(path, input)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.name).toBe('StyraRunError')
      expect(err.message).toBe('Assert failed: Check failed: Query failed: Unexpected status code: 500')
      expect(err.cause.name).toBe('StyraRunError')
      expect(err.cause.message).toBe('Check failed: Query failed: Unexpected status code: 500')
      expect(err.cause.cause.name).toBe('StyraRunError')
      expect(err.cause.cause.message).toBe('Query failed: Unexpected status code: 500')
      expect(err.cause.cause.cause.name).toBe('StyraRunHttpError')
      expect(err.cause.cause.cause.message).toBe('Unexpected status code: 500')
      expect(err.cause.cause.cause.statusCode).toBe(500)
      expect(err.cause.cause.cause.attempts).toBe(1)
      expect(err.cause.cause.cause.body).toBe('some error happened')
    }
  })
})


describe("Filter allowed", () => {
  let httpSpy

  const port = 8082
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const path = 'foo/allowed'
  const client = StyraRun('http://placeholder', 'foobar')
  client.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  const toInput = (v, i) => { 
    return i % 2 == 0 ? {d: v} : undefined 
  }

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [{
        method: 'post',
        url: `/${basePath}/data_batch`,
        handlerName: 'getMockedUrl'
      }
    ])
    httpSpy.server.start(8082, done)
  })
  
  afterAll(function(done) {
    httpSpy.server.stop(done)
  })

  afterEach(function() {
    httpSpy.getMockedUrl.calls.reset();
  })

  it("Successful, empty list", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: []
    })

    const list = []
    const expectedList = []

    const result = await client.filter(list, defaultPredicate, path)
    expect(result).toEqual(expectedList)
  })

  it("Successful, filtered", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: {
        result: [
        {result: true},
        {result: false},
        {},
        {result: 42},
        {result: true},
        {result: true},
      ]}
    })

    const expectedQuery = {
      items: [
        {path: 'foo/allowed', input: {d: 'do'}},
        {path: 'foo/allowed'},
        {path: 'foo/allowed', input: {d: 'mi'}},
        {path: 'foo/allowed'},
        {path: 'foo/allowed', input: {d: 'so'}},
        {path: 'foo/allowed'},
      ]
    }

    const list = ['do', 're', 'mi', 'fa', 'so', 'la']
    const expectedList = ['do', 'so', 'la']

    const result = await client.filter(list, defaultPredicate, path, toInput)
    expect(result).toEqual(expectedList)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: expectedQuery
    }));
  })

  it("Successful, path overrides", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: {
        result: [
        {result: true},
        {result: true},
        {result: true},
        {result: true},
        {result: true},
        {result: true},
      ]}
    })

    const toPath = (_, i) => {
      return i % 2 == 0 ? `bar/${i}` : undefined
    }

    const expectedQuery = {
      items: [
        {path: 'bar/0'},
        {path: 'foo/allowed'},
        {path: 'bar/2'},
        {path: 'foo/allowed'},
        {path: 'bar/4'},
        {path: 'foo/allowed'},
      ]
    }

    const list = ['do', 're', 'mi', 'fa', 'so', 'la']

    const result = await client.filter(list, defaultPredicate, path, undefined, toPath)
    expect(result).toEqual(list)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: expectedQuery
    }));
  })

  it("Missing path", async () => {
    const toPath = (_, i) => {
      return i == 3 ? undefined : `bar/${i}`
    }

    const list = ['do', 're', 'mi', 'fa', 'so', 'la']

    try {
      const result = await client.filter(list, defaultPredicate, undefined, undefined, toPath)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.name).toBe('StyraRunError')
      expect(err.message).toBe('Filtering failed: No \'path\' provided for list entry at 3')
      expect(err.cause.name).toBe('StyraRunError')
      expect(err.cause.message).toBe("No 'path' provided for list entry at 3")
      expect(err.cause.path).toBeUndefined()
      expect(err.cause.query).toBeUndefined()
    }
  })
})

describe("Proxy", () => {
  let httpSpy

  const input = {foo: 'bar'}
  const port = 8082
  const basePath = 'v1/projects/user1/proj1/envs/env1'
  const path = 'foo/allowed'
  const sdkClient = StyraRun('http://placeholder', 'foobar')
  sdkClient.apiClient.gateways = [Url.parse(`http://localhost:${port}/${basePath}`)]

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [{
        method: 'post',
        url: `/${basePath}/data_batch`,
        handlerName: 'getMockedUrl'
      }
    ])
    httpSpy.server.start(8082, done)
  })
  
  afterAll(function(done) {
    httpSpy.server.stop(done)
  })

  afterEach(function() {
    httpSpy.getMockedUrl.calls.reset();
  })

  it("Success, no callback", async () => {
    const expectedResult = {
      result: true
    }
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: toApiBatchResponseBody(expectedResult)
    })

    const server = http.createServer();
    server.addListener('request', sdkClient.proxy())

    await withServer(server, 8081, async () => {
      const {response, body} = await clientRequest(8081, 'POST', '/proxy', 
        JSON.stringify(toProxyRequestBody(path, input)))

      expect(response.statusCode).toBe(200)
      expect(body).toBe(JSON.stringify(toProxyResponseBody(expectedResult)))
      expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
        body: toApiBatchRequestBody(path, input)
      }));
    })
  })

  it("Success, with callback", async () => {
    const expectedResult = {
      result: true
    }
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: toApiBatchResponseBody(expectedResult)
    })

    const proxyCallback = async (req, res, path, input) => {
      return {
        ...input,
        pr: 'oxy'
      }
    }

    const server = http.createServer();
    server.addListener('request', sdkClient.proxy(proxyCallback))

    await withServer(server, 8081, async () => {
      const {response, body} = await clientRequest(8081, 'POST', '/proxy', 
        JSON.stringify(toProxyRequestBody(path, input)))

      expect(response.statusCode).toBe(200)
      expect(body).toBe(JSON.stringify(toProxyResponseBody(expectedResult)))
      expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
        body: toApiBatchRequestBody(path, {
            ...input,
            pr: 'oxy'
          })
      }));
    })
  })

  it("Success, with callback throwing exception", async () => {
    const proxyCallback = async (req, res, input) => {
      throw Error("FOO BAR")
    }

    const server = http.createServer();
    server.addListener('request', sdkClient.proxy(proxyCallback))

    await withServer(server, 8081, async () => {
      const {response, body} = await clientRequest(8081, 'POST', '/proxy', 
        JSON.stringify(toProxyRequestBody(path, input)))

      expect(response.statusCode).toBe(500)
      expect(body).toBe('policy check failed')
    })
  })

  it("Success, rejected", async () => {
    const expectedResult = {}
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: toApiBatchResponseBody(expectedResult)
    })

    const server = http.createServer();
    server.addListener('request', sdkClient.proxy())

    await withServer(server, 8081, async () => {
      const {response, body} = await clientRequest(8081, 'POST', '/proxy', 
        JSON.stringify(toProxyRequestBody(path, input)))

      expect(response.statusCode).toBe(200)
      expect(body).toBe(JSON.stringify(toProxyResponseBody(expectedResult)))
      expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
        body: toApiBatchRequestBody(path, input)
      }));
    })
  })

  it("Success, back-end failure", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 400,
      body: 'ERROR'
    })

    const server = http.createServer();
    server.addListener('request', sdkClient.proxy())

    await withServer(server, 8081, async () => {
      const {response, body} = await clientRequest(8081, 'POST', '/proxy', 
        JSON.stringify(toProxyRequestBody(path, input)))
      expect(response.statusCode).toBe(500)
      expect(body).toBe('policy check failed')
      expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
        body: toApiBatchRequestBody(path, input)
      }));
    })
  })
})

function toProxyRequestBody(path, input) {
  return {items: [{path, input}]}
}

function toProxyResponseBody(result) {
  return {result: [result]}
}

function toApiBatchRequestBody(path, input) {
  return {
    items: [{
      path, input
    }]
  }
}

function toApiBatchResponseBody(result) {
  return {
    result: [
      result
    ]
  }
}
