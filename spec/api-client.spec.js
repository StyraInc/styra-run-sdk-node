import Url from "url"
import serverSpy from "jasmine-http-server-spy"
import { ApiClient } from "../src/api-client.js"

describe("Gateway lookup", () => {
    let httpSpy

    const port = 8082
    const url = `http://localhost:${port}/api`
    const token = 'foobar'

    beforeAll((done) => {
        httpSpy = serverSpy.createSpyObj('mockServer', [
            {
                method: 'get',
                url: '/api/gateways',
                handlerName: 'getGatewayUrl'
            },
            {
                method: 'get',
                url: '/my/api/foo/bar',
                handlerName: 'getApiUrl'
            },
            {
                method: 'post',
                url: '/my/api/foo/bar',
                handlerName: 'postApiUrl'
            },
            {
                method: 'put',
                url: '/my/api/foo/bar',
                handlerName: 'putApiUrl'
            },
            {
                method: 'delete',
                url: '/my/api/foo/bar',
                handlerName: 'deleteApiUrl'
            }
        ])

        httpSpy.server.start(port, done)
    })

    afterAll(function (done) {
        httpSpy.server.stop(done)
    })

    afterEach(function () {
        httpSpy.getGatewayUrl.calls.reset()
        httpSpy.getApiUrl.calls.reset()
        httpSpy.postApiUrl.calls.reset()
        httpSpy.putApiUrl.calls.reset()
        httpSpy.deleteApiUrl.calls.reset()
    })

    it("getGateways() can be called directly", async () => {
        const client = new ApiClient(url, token)

        httpSpy.getGatewayUrl.and.returnValue({
            statusCode: 200,
            body: {
                result: [
                    {
                        aws: {
                            region: 'foo',
                            zone: 'foo1'
                        },
                        gateway_url: 'http://localhost:8082/my/api'
                    },
                    {
                        note: 'missing gateway_url'
                    },
                    {
                        note: 'broken gateway_url',
                        gateway_url: 42
                    },
                    {
                        foo: {
                            bar: 'baz'
                        },
                        gateway_url: 'https://example.com'
                    }
                ]
            }
        })

        const gateways = await client.getGateways()

        expect(gateways.length).toBe(2)
        expect(gateways[0]).toEqual(Url.parse('http://localhost:8082/my/api'))
        expect(gateways[1]).toEqual(Url.parse('https://example.com'))

        expect(httpSpy.getGatewayUrl).toHaveBeenCalled()
    })

    it("gateways API endpoint is called only once", async () => {
        const client = new ApiClient(url, token)

        httpSpy.getGatewayUrl.and.returnValue({
            statusCode: 200,
            body: {
                result: [{
                    gateway_url: 'http://localhost:8082/my/api'
                }]
            }
        })

        const gateways = await client.getGateways()
        const gateways2 = await client.getGateways()
        
        expect(gateways).toEqual(gateways2)
        expect(httpSpy.getGatewayUrl).toHaveBeenCalledOnceWith(jasmine.objectContaining({}))
    })

    it("getGateways() is called before any request", async () => {
        const client = new ApiClient(url, token)
        const apiPath = 'foo/bar'
        const expectedData = {foo: 'bar'}
        const postBody = {do: 're'}
        const putBody = {mi: 'fa'}

        httpSpy.getGatewayUrl.and.returnValue({
            statusCode: 200,
            body: {
                result: [{
                    gateway_url: 'http://localhost:8082/my/api'
                }]
            }
        })
        httpSpy.getApiUrl.and.returnValue({
            statusCode: 200,
            body: expectedData
        })
        httpSpy.postApiUrl.and.returnValue({
            statusCode: 200,
            body: expectedData
        })
        httpSpy.putApiUrl.and.returnValue({
            statusCode: 200,
            body: expectedData
        })
        httpSpy.deleteApiUrl.and.returnValue({
            statusCode: 200
        })

        const getData = await client.get(apiPath)
        const postData = await client.post(apiPath, JSON.stringify(postBody))
        const putData = await client.put(apiPath, JSON.stringify(putBody))
        await client.delete(apiPath)

        expect(JSON.parse(getData)).toEqual(expectedData)
        expect(JSON.parse(postData)).toEqual(expectedData)
        expect(JSON.parse(putData)).toEqual(expectedData)

        expect(httpSpy.getGatewayUrl).toHaveBeenCalledOnceWith(jasmine.objectContaining({}))
        expect(httpSpy.getApiUrl).toHaveBeenCalledOnceWith(jasmine.objectContaining({}))
        expect(httpSpy.postApiUrl).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            body: postBody
        }))
        expect(httpSpy.putApiUrl).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            body: putBody
        }))
        expect(httpSpy.deleteApiUrl).toHaveBeenCalledOnceWith(jasmine.objectContaining({}))
    })

    it("the list of gateways can be sorted", async () => {})
})

describe("Gateway failover", () => {
    let httpSpy

    const port = 8082
    const baseUrl = `http://localhost:${port}`
    const token = 'foobar'
    const expectedData = {result: true}

    beforeAll((done) => {
        httpSpy = serverSpy.createSpyObj('mockServer', [
            {
                method: 'get',
                url: '/ok/api',
                handlerName: 'getOkUrl'
            },
            {
                method: 'get',
                url: '/421/api',
                handlerName: 'get421Url'
            },
            {
                method: 'get',
                url: '/500/api',
                handlerName: 'get500Url'
            },
            {
                method: 'get',
                url: '/502/api',
                handlerName: 'get502Url'
            },
            {
                method: 'get',
                url: '/503/api',
                handlerName: 'get503Url'
            },
            {
                method: 'get',
                url: '/504/api',
                handlerName: 'get504Url'
            }
        ])

        httpSpy.getOkUrl.and.returnValue({
            statusCode: 200,
            body: expectedData
        })
        
        httpSpy.get421Url.and.returnValue({
            statusCode: 421,
            body: 'Misdirected Request'
        })

        httpSpy.get500Url.and.returnValue({
            statusCode: 500,
            body: 'Internal Server Error'
        })

        httpSpy.get502Url.and.returnValue({
            statusCode: 502,
            body: 'Bad Gateway'
        })

        httpSpy.get503Url.and.returnValue({
            statusCode: 503,
            body: 'Service Unavailable'
        })

        httpSpy.get504Url.and.returnValue({
            statusCode: 504,
            body: 'Gateway Timeout'
        })

        httpSpy.server.start(port, done)
    })

    afterAll(function (done) {
        httpSpy.server.stop(done)
    })

    afterEach(function () {
        httpSpy.getOkUrl.calls.reset()
        httpSpy.get421Url.calls.reset()
        httpSpy.get500Url.calls.reset()
        httpSpy.get502Url.calls.reset()
        httpSpy.get503Url.calls.reset()
        httpSpy.get504Url.calls.reset()
    })

    it("failed requests will be retried against the next gateway in the list", async () => {
        // Set client.gateways directly; call to /gateways API endpoint is tested elsewhere
        const client = new ApiClient('http://placeholder', token, {maxRetries: 10})
        client.gateways = [
            Url.parse('http://localhost/no/listener'),
            Url.parse(`${baseUrl}/421`),
            Url.parse(`${baseUrl}/500`),
            Url.parse(`${baseUrl}/502`),
            Url.parse(`${baseUrl}/503`),
            Url.parse(`${baseUrl}/504`),
            Url.parse(`${baseUrl}/ok`)
        ]

        const result = await client.get('api')
        expect(JSON.parse(result)).toEqual(expectedData)

        expect(httpSpy.get421Url).toHaveBeenCalledWith(jasmine.objectContaining({
            body: {}
        }))
        expect(httpSpy.get500Url).toHaveBeenCalledWith(jasmine.objectContaining({
            body: {}
        }))
        expect(httpSpy.get502Url).toHaveBeenCalledWith(jasmine.objectContaining({
            body: {}
        }))
        expect(httpSpy.get503Url).toHaveBeenCalledWith(jasmine.objectContaining({
            body: {}
        }))
        expect(httpSpy.get504Url).toHaveBeenCalledWith(jasmine.objectContaining({
            body: {}
        }))
        expect(httpSpy.getOkUrl).toHaveBeenCalledWith(jasmine.objectContaining({
            body: {}
        }))
    })

    it("max retries setting is respected", async () => {
        // Set client.gateways directly; call to /gateways API endpoint is tested elsewhere
        const client = new ApiClient('http://placeholder', token, {maxRetries: 2})
        client.gateways = [
            Url.parse('http://localhost/no/listener'),
            Url.parse(`${baseUrl}/421`),
            Url.parse(`${baseUrl}/500`),
            Url.parse(`${baseUrl}/502`),
            Url.parse(`${baseUrl}/503`),
            Url.parse(`${baseUrl}/504`),
            Url.parse(`${baseUrl}/ok`)
        ]

        try {
            const result = await client.get('api')
            fail(`Expected error, got: ${result}`)
        } catch (err) {
            expect(err.message).toBe('Request failed after 3 attempt(s)')
            expect(err.cause).toBeDefined()
            expect(err.cause?.message).toBe('Unexpected status code: 500')
            expect(err.cause?.body).toBe('Internal Server Error')
            expect(err.cause?.statusCode).toBe(500)
        }

        expect(httpSpy.get421Url).toHaveBeenCalledWith(jasmine.objectContaining({
            body: {}
        }))
        expect(httpSpy.get500Url).toHaveBeenCalledWith(jasmine.objectContaining({
            body: {}
        }))
        expect(httpSpy.get502Url).toHaveBeenCalledTimes(0)
        expect(httpSpy.get503Url).toHaveBeenCalledTimes(0)
        expect(httpSpy.get504Url).toHaveBeenCalledTimes(0)
        expect(httpSpy.getOkUrl).toHaveBeenCalledTimes(0)
    })

    it("retry count won't exceed gateway length", async () => {
        // Set client.gateways directly; call to /gateways API endpoint is tested elsewhere
        const client = new ApiClient('http://placeholder', token, {maxRetries: 100})
        client.gateways = [
            Url.parse(`${baseUrl}/500`)
        ]

        try {
            const result = await client.get('api')
            fail(`Expected error, got: ${result}`)
        } catch (err) {
            expect(err.message).toBe('Request failed after 1 attempt(s)')
            expect(err.cause).toBeDefined()
            expect(err.cause?.message).toBe('Unexpected status code: 500')
            expect(err.cause?.body).toBe('Internal Server Error')
            expect(err.cause?.statusCode).toBe(500)
        }

        expect(httpSpy.get421Url).toHaveBeenCalledTimes(0)
        expect(httpSpy.get500Url).toHaveBeenCalledOnceWith(jasmine.objectContaining({
            body: {}
        }))
        expect(httpSpy.get502Url).toHaveBeenCalledTimes(0)
        expect(httpSpy.get503Url).toHaveBeenCalledTimes(0)
        expect(httpSpy.get504Url).toHaveBeenCalledTimes(0)
        expect(httpSpy.getOkUrl).toHaveBeenCalledTimes(0)
    })
})