import http from "node:http"
import serverSpy from "jasmine-http-server-spy"
import { resolve } from "path"
import sdk, { DEFAULT_PREDICATE, NOT_ALLOWED, StyraRunAssertionError } from "../src/run-sdk.js"

describe("Check", () => {
  let httpSpy

  const port = 8082
  const path = 'foo/allowed'
  const client = sdk.New({
    userId: "user1",
    projectId: "proj1",
    evironmentId: "env1",
    port: port,
    host: "localhost",
    https: false
  })

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [{
        method: 'post',
        url: `${client.getPathPrefix()}/data/${path}`,
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

    const result = await client.check(path)
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

    const result = await client.check(path, input)
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

    const result = await client.check(path, input)
    expect(result).toEqual(expectedResult)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {input}
    }));
  })

  it("Successful, empty response", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200
    })

    const result = await client.check(path)
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
      const result = await client.check(path, input)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.message).toBe('Check failed')
      expect(err.path).toBe(path)
      expect(err.query).toEqual({input})
      expect(err.cause).toBeDefined()
      expect(err.cause.message).toBe('Unexpected status code: 400')
      expect(err.cause.statusCode).toBe(400)
      expect(err.cause.body).toBe("foo bar")
    }
  })

  it("Invalid response json body", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: "foo bar"
    })

    const input = {foo: "bar"}

    // Cannot use expectAsync().toBeRejectedWith(), as it doesn't allow us to assert error properties other than message
    try {
      const result = await client.check(path, input)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.message).toBe('Check failed')
      expect(err.path).toBe(path)
      expect(err.query).toEqual({input})
      expect(err.cause).toBeDefined()
      expect(err.cause.message).toBe('Invalid JSON')
    }
  })
})


describe("Batched Check", () => {
  let httpSpy

  const port = 8082
  const path = 'foo/allowed'
  const client = sdk.New({
    uid: "user1",
    pid: "proj1",
    eid: "env1",
    port: port,
    host: "localhost",
    https: false
  })

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [{
        method: 'post',
        url: `${client.getPathPrefix()}/data_batch`,
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
      {result: true},
      {},
      {result: 1337}
    ]
    const items = [
      {path: '/foo'},
      {path: '/bar', input: {subject: 'admin'}},
      {path: '/baz', input: 42}
    ]

    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: expectedResult
    })

    const result = await client.batchCheck(items)
    expect(result).toEqual(expectedResult)
    expect(httpSpy.getMockedUrl).toHaveBeenCalledWith(jasmine.objectContaining({
      body: {items}
    }));
  })

  it("Successful, with global input", async () => {
    const expectedResult = [
      {result: true},
      {},
      {result: 1337}
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
      body: expectedResult
    })

    const result = await client.batchCheck(items, input)
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

    const result = await client.batchCheck([])
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
      const result = await client.batchCheck(items, input)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.message).toBe('Batched check failed')
      expect(err.path).toBeUndefined()
      expect(err.query).toEqual({items, input})
      expect(err.cause).toBeDefined()
      expect(err.cause.message).toBe('Unexpected status code: 400')
      expect(err.cause.statusCode).toBe(400)
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
      const result = await client.batchCheck(items, input)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.message).toBe('Batched check failed')
      expect(err.path).toBeUndefined()
      expect(err.query).toEqual({items, input})
      expect(err.cause).toBeDefined()
      expect(err.cause.message).toBe('Invalid JSON')
    }
  })
})


describe("Allow", () => {
  let httpSpy

  const port = 8082
  const path = 'foo/allowed'
  const client = sdk.New({
    uid: "user1",
    pid: "proj1",
    eid: "env1",
    port: port,
    host: "localhost",
    https: false
  })

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [{
        method: 'post',
        url: `${client.getPathPrefix()}/data/${path}`,
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
      .toBeRejectedWith(new StyraRunAssertionError(NOT_ALLOWED))
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
      expect(err.message).toBe('Allow check failed')
      expect(err.path).toBe(path)
      expect(err.query).toEqual({input})
      expect(err.cause?.name).toBe('StyraRunError')
      expect(err.cause?.message).toBe('Check failed')
      expect(err.cause?.cause?.name).toBe('StyraRunHttpError')
      expect(err.cause?.cause?.message).toBe('Unexpected status code: 500')
      expect(err.cause?.cause?.statusCode).toBe(500)
      expect(err.cause?.cause?.body).toBe('some error happened')
    }
  })
})


describe("Filter allowed", () => {
  let httpSpy

  const port = 8082
  const path = 'foo/allowed'
  const client = sdk.New({
    uid: "user1",
    pid: "proj1",
    eid: "env1",
    port: port,
    host: "localhost",
    https: false
  })

  const toInput = (v, i) => { 
    return i % 2 == 0 ? {d: v} : undefined 
  }

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [{
        method: 'post',
        url: `${client.getPathPrefix()}/data_batch`,
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

    const result = await client.filter(list, DEFAULT_PREDICATE, path)
    expect(result).toEqual(expectedList)
  })

  it("Successful, filtered", async () => {
    httpSpy.getMockedUrl.and.returnValue({
      statusCode: 200,
      body: {
        result: [
        {check: {result: true}},
        {check: {result: false}},
        {check: {}},
        {check: {result: 42}},
        {check: {result: true}},
        {check: {result: true}},
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

    const result = await client.filter(list, DEFAULT_PREDICATE, path, toInput)
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
        {check: {result: true}},
        {check: {result: true}},
        {check: {result: true}},
        {check: {result: true}},
        {check: {result: true}},
        {check: {result: true}},
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

    const result = await client.filter(list, DEFAULT_PREDICATE, path, undefined, toPath)
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
      const result = await client.filter(list, DEFAULT_PREDICATE, undefined, undefined, toPath)
      fail(`Expected error, got: ${result}`)
    } catch (err) {
      expect(err.message).toBe('Allow filtering failed')
      expect(err.path).toBeUndefined()
      expect(err.query).toBeUndefined()
      expect(err.cause?.message).toBe("No 'path' provided for list entry at 3")
      expect(err.cause?.path).toBeUndefined()
      expect(err.cause?.query).toBeUndefined()
    }
  })
})

describe("Proxy", () => {
  let httpSpy

  const port = 8082
  const path = 'foo/allowed'
  const input = {foo: "bar"}
  const sdkClient = sdk.New({
    uid: "user1",
    pid: "proj1",
    eid: "env1",
    port: port,
    host: "localhost",
    https: false
  })

  beforeAll(function(done) {
    httpSpy = serverSpy.createSpyObj('mockServer', [{
        method: 'post',
        url: `${sdkClient.getPathPrefix()}/data_batch`,
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

function clientRequest(port, method, path, data = undefined) {
  const options = {
    port,
    path,
    method,
    host: 'localhost'
  }

  return new Promise((resolve, reject) => {
    const req = http.request(options, (response) => {
      let body = ''

      //another chunk of data has been received
      response.on('data', (chunk) => {
        body += chunk
      })

      //the whole response has been received
      response.on('end', () => {
        resolve({response, body})
      })
    }).on('error', (err) => {
      reject(new Error('Failed to send request', {
        cause: err
      }))
    });
    if (data) {
      req.write(data)
    }
    req.end()
  })
}

async function withServer(server, port, callback) {
  await startServer(server, port)
  await callback(server)
  await closeServer(server)
}

async function startServer(server, port) {
  await new Promise((resolve, reject) => {
    server.listen(8081, (err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

function toProxyRequestBody(path, input) {
  return [{path, input}]
}

function toProxyResponseBody(result) {
  return [result]
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
      {
        check: result
      }
    ]
  }
}
