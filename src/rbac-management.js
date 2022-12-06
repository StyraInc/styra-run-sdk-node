import {ApiError, InvalidInputError, StyraRunError} from "./errors.js"

export const EventType = {
  RBAC: 'rbac',
  GET_ROLES: 'rbac-get-roles',
  GET_BINDING: 'rbac-get-user-binding',
  GET_BINDINGS: 'rbac-get-user-bindings',
  SET_BINDING: 'rbac-set-user-binding',
  DELETE_BINDING: 'rbac-delete-user-binding'
}

const RbacPath = {
  AUTHZ: 'rbac/manage/allow',
  ROLES: 'rbac/roles',
  BINDINGS_PREFIX: 'rbac/user_bindings'
}

/**
 * RBAC management authorization policy input document
 *
 * @typedef {Object} RbacInputDocument
 * @property {string} subject the subject identifying the user performing the RBAC operation
 * @property {string} tenant the tenant of the user performing the RBAC operation
 */

/**
 * RBAC management client.
 */
export class RbacManager {
  /**
   * @param {StyraRunClient} styraRunClient
   */
  constructor(styraRunClient) {
    this.styraRunClient = styraRunClient
  }

  /**
   * Gets the list of available rule identifiers.
   *
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<string[]>} a list of string role identifiers
   */
  async getRoles(authzInput) {
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    const roles = await this.styraRunClient.query(RbacPath.ROLES)
      .then(resp => resp.result)

    this.styraRunClient.signalEvent(EventType.GET_ROLES, {input: authzInput, roles})

    return roles
  }

  /**
   * @typedef {Object} UserBinding
   * @property {string} id the user identifier
   * @property {string[]} roles the list of role identifiers bound to the user
   */
  /**
   * Gets a list of user bindings corresponding to the provided list of user identifiers.
   *
   * @param {string[]} users the list of string identifiers for the users to retrieve bindings for
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<UserBinding[]>} the list of user bindings
   */
  async getUserBindings(users, authzInput) {
    const tenant = getTenant(authzInput)
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    const bindings = await Promise.all(users.map(async (id) => {
      const roles = await this.styraRunClient.getData(`${RbacPath.BINDINGS_PREFIX}/${tenant}/${id}`, [])
        .then(resp => resp.result)
      return {id, roles}
    }))

    this.styraRunClient.signalEvent(EventType.GET_BINDINGS, {input: authzInput, bindings})

    return bindings
  }

  /**
   * Lists all user bindings.
   *
   * Note: this function is primarily meant for systems with few user bindings stored in Styra Run,
   * and its use is not recommended when a large amount of user bindings might get enumerated.
   * It is recommended to use {@link getUserBindings} instead, where the number of returned bindings can be controlled by the caller.
   *
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<UserBinding[]>} the list of user bindings
   */
  async listUserBindings(authzInput) {
    const tenant = getTenant(authzInput)
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    const bindingsByUser = await this.styraRunClient.getData(`${RbacPath.BINDINGS_PREFIX}/${tenant}`, {})
      .then(resp => resp.result)

    const bindings = Object.keys(bindingsByUser).map((id) => ({id, roles: bindingsByUser[id]}))

    this.styraRunClient.signalEvent(EventType.GET_BINDINGS, {input: authzInput, bindings})

    return bindings
  }

  /**
   * Gets the binding for a given user.
   *
   * @param {string} id the user identifier
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<string[]>}
   */
  async getUserBinding(id, authzInput) {
    const tenant = getTenant(authzInput)
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    try {
      const {result} = await this.styraRunClient.getData(`${RbacPath.BINDINGS_PREFIX}/${tenant}/${id}`)
      this.styraRunClient.signalEvent(EventType.GET_BINDING, {id, input: authzInput, binding: result})
      return result || []
    } catch (err) {
      this.styraRunClient.signalEvent(EventType.GET_BINDING, {id, input: authzInput, err})
      throw new ApiError('Binding fetch failed', err)
    }
  }

  /**
   * Sets the binding for a given user.
   *
   * @param {string} id the user identifier
   * @param {string[]} roles a list of role identifiers
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<void>}
   */
  async setUserBinding(id, roles, authzInput) {
    const tenant = getTenant(authzInput)
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    try {
      await this.styraRunClient.putData(`${RbacPath.BINDINGS_PREFIX}/${tenant}/${id}`, roles ?? [])
      this.styraRunClient.signalEvent(EventType.SET_BINDING, {id, roles, input: authzInput})
    } catch (err) {
      this.styraRunClient.signalEvent(EventType.SET_BINDING, {id, roles, input: authzInput, err})
      throw new ApiError('Binding update failed', err)
    }
  }

  /**
   * Deletes the binding of a given user.
   *
   * @param {string} id the user identifier
   * @param {RbacInputDocument} authzInput the input document required by the manage RBAC policy rule
   * @returns {Promise<void>}
   */
  async deleteUserBinding(id, authzInput) {
    const tenant = getTenant(authzInput)
    await this.styraRunClient.assert(RbacPath.AUTHZ, authzInput)

    try {
      await this.styraRunClient.deleteData(`${RbacPath.BINDINGS_PREFIX}/${tenant}/${id}`)
      this.styraRunClient.signalEvent(EventType.DELETE_BINDING, {id, input: authzInput})
    } catch (err) {
      this.styraRunClient.signalEvent(EventType.DELETE_BINDING, {id, input: authzInput, err})
      throw new ApiError('Binding update failed', err)
    }
  }
}

function getTenant(authzInput) {
  if (authzInput.tenant) {
    return authzInput.tenant
  }
  throw new StyraRunError('Missing required tenant parameter on authz input document')
}
