import {getBody, toJson, fromJson} from "./helpers.js"
import { StyraRunError } from "./errors.js"

export class Manager {
  constructor(styraRunClient, createInput) {
    this.styraRunClient = styraRunClient
    this.createInput = createInput
  }

  async getRoles(request, response) {
    const input = await this.createInput(request)
    await this.styraRunClient.assert('rbac/manage/allow', input)

    const roles = await this.styraRunClient.check('rbac/roles', input)
      .then(resp => resp.result)

    this.styraRunClient.handleEvent('rbac-get-roles', {input, roles})

    response.writeHead(200, {'Content-Type': 'application/json'})
    response.end(toJson(roles))
  }

  async getBindings(request, response) {
    const input = await this.createInput(request)
    await this.styraRunClient.assert('rbac/manage/allow', input)

    const bindings = await this.styraRunClient.getData('rbac/user_bindings/' + input.tenant)
      .then(resp => resp.result)

    this.styraRunClient.handleEvent('rbac-get-bindings', {input, bindings})

    response.writeHead(200, {'Content-Type': 'application/json'})
    response.end(toJson(bindings))
  }

  async setBinding(request, response) {
    const input = await this.createInput(request)
    await this.styraRunClient.assert('rbac/manage/allow', input)

    const body = await getBody(request)
    const data = fromJson(body)

    await this.styraRunClient.putData('rbac/user_bindings/' + input.tenant + '/' + data.user, [data.role])

    this.styraRunClient.handleEvent('rbac-set-binding', {input})

    response.writeHead(200, {'Content-Type': 'application/json'})
    response.end()
  }

  async handle(request, response) {
    try {
      if (request.path.endsWith('/roles') && request.method === 'GET') {
        await this.getRoles(request, response)
      } else if (request.path.endsWith('/user_bindings') && request.method === 'GET') {
        await this.getBindings(request, response)
      } else if (request.path.endsWith('/user_bindings') && request.method === 'POST') {
        await this.setBinding(request, response)
      } else {
        response.writeHead(404, {'Content-Type': 'text/plain'})
        response.end('Not Found')
      }
    } catch (err) {
      this.styraRunClient.handleEvent('rbac', {err})
      if (err instanceof StyraRunError) {
        response.writeHead(403, {'Content-Type': 'text/plain'})
        response.end('Forbidden')
      } else {
        response.writeHead(500, {'Content-Type': 'text/plain'})
        response.end('Error')
      }
    }
  }
}
