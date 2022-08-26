import http from "node:http"

export function clientRequest(port, method, path, data = undefined) {
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

export async function withServer(server, port, callback) {
  try {
    await startServer(server, port)
    await callback(server)
  } finally {
    await closeServer(server)
  }
}

export async function startServer(server, port) {
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

export async function closeServer(server) {
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
