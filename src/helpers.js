export function getBody(stream) {
  return new Promise((resolve, reject) => {
    if (stream.body) {
      // express compatibility
      resolve(stream.body)
    } else {
      var body = ''
      stream.on('data', (data) => {
        body += data
      })
      stream.on('end', () => {
        resolve(body)
      })
    }
  })
}

export function toJson(data) {
  const json = JSON.stringify(data);
  if (json) {
    return json
  } else {
    throw new Error('JSON serialization produced undefined result')
  }
}

export function fromJson(val) {
  if (typeof val === 'object') {
    return val
  }
  try {
    return JSON.parse(val)
  } catch (err) {
    throw new Error('Invalid JSON', {cause: err})
  }
}

export function pathEndsWith(url, requiredTail) {
  const components = url.pathname.split('/')
    .filter((e) => e.length > 0)
  if (requiredTail.length > components.length) {
    return false
  }

  const tailStart = components.length - requiredTail.length
  const pathTail = components.slice(tailStart)

  for (let i = 0; i < requiredTail.length; i++) { 
    const required = requiredTail[i]
    if (required !== '*' && required !== pathTail[i]) {
      return false
    }
  }

  return true
}

export function parsePathParameters(url, expectedTail) {
  const components = url.pathname.split('/')
  if (expectedTail.length > components.length) {
    return {}
  }

  const tailStart = components.length - expectedTail.length
  const pathTail = components.slice(tailStart)
  const parameters = {}
  
  for (let i = 0; i < expectedTail.length; i++) { 
    const expected = expectedTail[i]
    if (expected.startsWith(':')) {
      parameters[expected.slice(1)] = pathTail[i]
    }
  }

  return parameters
}