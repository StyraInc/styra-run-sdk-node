import {getBody, toJson, fromJson} from "./helpers.js"
import { StyraRunError, StyraRunHttpError } from "./errors.js"

export class Manager {
  constructor(styraRunClient, getUsers, createInput, onSetBinding) {
    this.styraRunClient = styraRunClient
    this.getUsers = getUsers
    this.createInput = createInput
    this.onSetBinding = onSetBinding
  }

  async getRoles(input) {
    await this.styraRunClient.assert('rbac/manage/allow', input)

    const roles = await this.styraRunClient.check('rbac/roles', input)
      .then(resp => resp.result)

    this.styraRunClient.handleEvent('rbac-get-roles', {input, roles})

    return roles
  }

  async getBindings(input) {
    await this.styraRunClient.assert('rbac/manage/allow', input)

    const users = this.getUsers()

    const bindings = await Promise.all(users.map(async (id) => {
      const roles = await this.styraRunClient.getData(`rbac/user_bindings/${input.tenant}/${id}`, [])
        .then(resp => resp.result)
      return {id, roles}
    }))

    this.styraRunClient.handleEvent('rbac-get-bindings', {input, bindings})

    return bindings
  }

  // TODO: Take a dictionary (list?) of username->roles bindings
  async setBindings(bindings, input) {
    await this.styraRunClient.assert('rbac/manage/allow', input)

    await Promise.allSettled(bindings.map(async (binding) => {
      try {
        await this.styraRunClient.putData('rbac/user_bindings/' + input.tenant + '/' + binding.id, binding.roles ?? [])
        await this.styraRunClient.handleEvent('rbac-set-binding', {binding, input})
      } catch (err) {
        await this.styraRunClient.handleEvent('rbac-set-binding', {binding, input, err})
      }
    }))
  }

  async handle(request, response) {
    let responseBody
    try {
      const input = await this.createInput(request)

      if (request.path.endsWith('/roles') && request.method === 'GET') {
        responseBody = await this.getRoles(input)
      } else if (request.path.endsWith('/user_bindings') && request.method === 'GET') {
        responseBody = await this.getBindings(input)
      } else if (request.path.endsWith('/user_bindings') && request.method === 'PUT') {
        const body = await getBody(request)
        const bindings = await sanitizeBindings(fromJson(body), this.onSetBinding)
        responseBody = await this.setBindings(bindings, input)
      } else {
        response.writeHead(404, {'Content-Type': 'text/plain'})
        response.end('Not Found')
        return
      }

      if (responseBody) {
        response.writeHead(200, {'Content-Type': 'application/json'})
        response.end(toJson(responseBody))
      } else {
        response.writeHead(200, {'Content-Type': 'application/json'})
        response.end()
      }
    } catch (err) {
      this.styraRunClient.handleEvent('rbac', {err})
      if (err instanceof StyraRunError) {
        response.writeHead(403, {'Content-Type': 'text/plain'})
        response.end('Forbidden')
      } else if (err instanceof InvalidInputError) {
        response.writeHead(400, {'Content-Type': 'text/plain'})
        response.end('Invalid request')
      } else {
        response.writeHead(500, {'Content-Type': 'text/plain'})
        response.end('Error')
      }
    }
  }
}

class InvalidInputError extends Error {
  constructor(message) {
    super(message)
  }
}

async function sanitizeBindings(data, onSetBinding) {
  if (!Array.isArray(data)) {
    throw new InvalidInputError('Bindings is not an array')
  }

  return await Promise.all(data.map(async (entry, i) => {
    const id = entry.id
    if (typeof id !== "string") {
      throw new InvalidInputError(`id is not a string on binding ${i}`)
    }

    const roles = entry.roles ?? []
    if (!Array.isArray(roles)) {
      throw new InvalidInputError(`roles is not an array on binding ${i}`)
    }

    if (await onSetBinding(id, roles) !== true) {
      throw new InvalidInputError(`binding ${i} rejected`)
    }

    return {id, roles}
  }))
}
