import serverSpy from "jasmine-http-server-spy"
import { AwsClient } from "../src/aws.js"

const TOKEN_HEADER = 'x-aws-ec2-metadata-token'

describe("AWS IMDSv2 is used to fetch metadata:", () => {
  let httpSpy

  const hostname = 'localhost'
  const port = 8082
  const host = `${hostname}:${port}`
  const url = `http://${host}`

  beforeAll((done) => {
    httpSpy = serverSpy.createSpyObj('mockServer', [
      {
        method: 'put',
        url: '/latest/api/token',
        handlerName: 'putToken'
      },
      {
        method: 'get',
        url: '/latest/meta-data/placement/region',
        handlerName: 'getRegion'
      },
      {
        method: 'get',
        url: '/latest/meta-data/placement/availability-zone-id',
        handlerName: 'getZoneId'
      }
    ])

    httpSpy.server.start(port, done)
  })

  afterAll((done) => {
    httpSpy.server.stop(done)
  })

  afterEach(() => {
    httpSpy.putToken.calls.reset()
    httpSpy.getRegion.calls.reset()
    httpSpy.getZoneId.calls.reset()
  })

  it("Token is requested if none already exists", async () => {
    const client = new AwsClient(url)
    const expectedToken = 'foobar'
    const expectedRegion = 'foo'
    const expectedZoneId = 'bar'

    httpSpy.putToken.and.returnValue({
      statusCode: 200,
      body: expectedToken
    })

    httpSpy.getRegion.and.returnValue({
      statusCode: 200,
      body: expectedRegion
    })

    httpSpy.getZoneId.and.returnValue({
      statusCode: 200,
      body: expectedZoneId
    })

    const metadata = await client.getMetadata()

    expect(metadata.region).toBe(expectedRegion)
    expect(metadata.zoneId).toBe(expectedZoneId)

    expect(httpSpy.putToken).toHaveBeenCalledTimes(1)
    expect(httpSpy.getRegion).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedToken
      })
    }))
    expect(httpSpy.getZoneId).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedToken
      })
    }))
  })

  it("Token is not requested if one already exists", async () => {
    const client = new AwsClient(url)
    const expectedToken = 'foobar'
    const expectedRegion = 'foo'
    const expectedZoneId = 'bar'

    client.token = expectedToken

    httpSpy.putToken.and.returnValue({
      statusCode: 200,
      body: expectedToken
    })

    httpSpy.getRegion.and.returnValue({
      statusCode: 200,
      body: expectedRegion
    })

    httpSpy.getZoneId.and.returnValue({
      statusCode: 200,
      body: expectedZoneId
    })

    const metadata = await client.getMetadata()

    expect(metadata.region).toBe(expectedRegion)
    expect(metadata.zoneId).toBe(expectedZoneId)

    expect(httpSpy.putToken).toHaveBeenCalledTimes(0)
    expect(httpSpy.getRegion).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedToken
      })
    }))
    expect(httpSpy.getZoneId).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedToken
      })
    }))
  })

  it("New token is requested if existing has expired", async () => {
    const client = new AwsClient(url)
    const expectedOldToken = 'one'
    const expectedNewToken = 'two'
    const expectedRegion = 'foo'
    const expectedZoneId = 'bar'

    client.token = expectedOldToken

    httpSpy.putToken.and.returnValue({
      statusCode: 200,
      body: expectedNewToken
    })

    const handleMetaRequest = (value) => {
      return (req) => {
        if (req.headers[TOKEN_HEADER] === expectedNewToken) {
          return {
            statusCode: 200,
            body: value
          }
        } else {
          return {
            statusCode: 401
          }
        }
      }
    }

    httpSpy.getRegion.and.callFake(handleMetaRequest(expectedRegion))
    httpSpy.getZoneId.and.callFake(handleMetaRequest(expectedZoneId))

    const metadata = await client.getMetadata()

    expect(metadata.region).toBe(expectedRegion)
    expect(metadata.zoneId).toBe(expectedZoneId)

    expect(httpSpy.putToken).toHaveBeenCalledTimes(1)

    expect(httpSpy.getRegion).toHaveBeenCalledTimes(2)
    expect(httpSpy.getRegion).toHaveBeenCalledWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedOldToken
      })
    }))
    expect(httpSpy.getRegion).toHaveBeenCalledWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedNewToken
      })
    }))

    expect(httpSpy.getZoneId).toHaveBeenCalledTimes(2)
    expect(httpSpy.getZoneId).toHaveBeenCalledWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedOldToken
      })
    }))
    expect(httpSpy.getZoneId).toHaveBeenCalledWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedNewToken
      })
    }))
  })

  it("IMDSv1 is used as fallback if no token can be retrieved", async () => {
    const client = new AwsClient(url)
    const expectedRegion = 'foo'
    const expectedZoneId = 'bar'

    httpSpy.putToken.and.returnValue({
      statusCode: 404
    })

    const handleMetaRequest = (value) => {
      return () => {
        return {
          statusCode: 200,
          body: value
        }
      }
    }

    httpSpy.getRegion.and.callFake(handleMetaRequest(expectedRegion))
    httpSpy.getZoneId.and.callFake(handleMetaRequest(expectedZoneId))

    const metadata = await client.getMetadata()

    expect(metadata.region).toBe(expectedRegion)
    expect(metadata.zoneId).toBe(expectedZoneId)

    expect(httpSpy.putToken).toHaveBeenCalledTimes(1)

    // Metadata endpoints called even though no token was fetched
    expect(httpSpy.getRegion).toHaveBeenCalledTimes(1)
    expect(httpSpy.getRegion).not.toHaveBeenCalledWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': jasmine.anything()
      })
    }))

    expect(httpSpy.getZoneId).toHaveBeenCalledTimes(1)
    expect(httpSpy.getZoneId).not.toHaveBeenCalledWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': jasmine.anything()
      })
    }))
  })

  it("Region metadata attribute is fetched even if zone-id request fails", async () => {
    const client = new AwsClient(url)
    const expectedToken = 'foobar'
    const expectedRegion = 'foo'
    const expectedZoneId = undefined

    httpSpy.putToken.and.returnValue({
      statusCode: 200,
      body: expectedToken
    })

    httpSpy.getRegion.and.returnValue({
      statusCode: 200,
      body: expectedRegion
    })

    httpSpy.getZoneId.and.returnValue({
      statusCode: 404
    })

    const metadata = await client.getMetadata()

    expect(metadata.region).toBe(expectedRegion)
    expect(metadata.zoneId).toBe(expectedZoneId)

    expect(httpSpy.putToken).toHaveBeenCalledTimes(1)
    expect(httpSpy.getRegion).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedToken
      })
    }))
    expect(httpSpy.getZoneId).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedToken
      })
    }))
  })

  it("Zone-id metadata attribute is fetched even if region request fails", async () => {
    const client = new AwsClient(url)
    const expectedToken = 'foobar'
    const expectedRegion = undefined
    const expectedZoneId = 'bar'

    httpSpy.putToken.and.returnValue({
      statusCode: 200,
      body: expectedToken
    })

    httpSpy.getRegion.and.returnValue({
      statusCode: 404
    })

    httpSpy.getZoneId.and.returnValue({
      statusCode: 200,
      body: expectedZoneId
    })

    const metadata = await client.getMetadata()

    expect(metadata.region).toBe(expectedRegion)
    expect(metadata.zoneId).toBe(expectedZoneId)

    expect(httpSpy.putToken).toHaveBeenCalledTimes(1)
    expect(httpSpy.getRegion).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedToken
      })
    }))
    expect(httpSpy.getZoneId).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedToken
      })
    }))
  })

  it("Trailing slashes are dropped from metadata attributes", async () => {
    const client = new AwsClient(url)
    const expectedToken = 'foobar'
    const expectedRegion = 'foo'
    const expectedZoneId = 'bar'

    httpSpy.putToken.and.returnValue({
      statusCode: 200,
      body: expectedToken
    })

    httpSpy.getRegion.and.returnValue({
      statusCode: 200,
      body: expectedRegion + '/'
    })

    httpSpy.getZoneId.and.returnValue({
      statusCode: 200,
      body: expectedZoneId + '/'
    })

    const metadata = await client.getMetadata()

    expect(metadata.region).toBe(expectedRegion)
    expect(metadata.zoneId).toBe(expectedZoneId)

    expect(httpSpy.putToken).toHaveBeenCalledTimes(1)
    expect(httpSpy.getRegion).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedToken
      })
    }))
    expect(httpSpy.getZoneId).toHaveBeenCalledOnceWith(jasmine.objectContaining({
      headers: jasmine.objectContaining({
        'x-aws-ec2-metadata-token': expectedToken
      })
    }))
  })
})
