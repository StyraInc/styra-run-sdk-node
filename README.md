# The Styra Run Node.js SDK

## How to Install

On the command line:

```sh
npm install --save styra-run-sdk-node
```

or in your package.json:
```json
{
    "dependencies": {
        "styra-run-sdk-node": "latest"
    }
}
```

## How to Use

### Instantiate a Run Client

```javascript
// Options are pulled from the environment
import StyraRun from "styra-run"

const client = StyraRun(process.env.RUN_URL, process.env.RUN_TOKEN)
```

### Query

Makes a policy rule query, returning the result object: `{"result": any}`

```javascript
const input = {...}
client.query('foo/bar/allowed', input)
    .then(({result}) => {
        if (result) {
            // Handle policy result
            ...
        }
        // Handle policy reject
        ...
        return Promise.reject(...)
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Check

Makes a policy rule query, returning `true` if the result object equals `{"result": true}`, `false` otherwise.

```javascript
const input = {...}
client.check('foo/bar/allowed', input)
    .then((allowed) => {
        if (allowed) {
            // Handle policy result
            ...
        }
        // Handle policy reject
        ...
        return Promise.reject(...)
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Assert

Makes a policy rule query, throwing an exception if the result document doesn't equal `{"result": true}`.
By default, the `assert()` function requires the policy decission to contain `{"result": true}`.

```javascript
const input = {...}
client.assert('foo/bar/allowed', input)
    .then(() => {
        // Handle accept
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

However, the default predicate can be overridden:

```javascript
const input = {...}
// Predicate that requires the policy rule to return a object containing a `{"role": "admin"}` entry.
const myPredicate = (response) => {
    return response?.result?.role === 'admin'
}
client.assert('foo/bar/allowed', input, myPredicate)
    .then(() => {
        // Handle accept
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

Often, when asserting that something is allowed according to a policy, there is some piece of data that should be processed in following steps. There is a convenience function for this case:

```javascript
const input = {...}
const maybeAllowedObject = ...
client.assertAndReturn(maybeAllowedObject, 'foo/bar/allowed', input)
    .then((allowedObject) => {
        // Do something with the allowed object
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Filtering

```javascript
import sdk, { DEFAULT_PREDICATE } from "run-sdk"

const list = ["do", "re", "mi"]
const toInput = (item) => {
    return {note: item}
}

// The default predicate asserts the policy decision is equal to `{"result": true}`
client.filter(list, DEFAULT_PREDICATE, 'foo/bar/allowed', list, toInput)
    .then((filteredList) => {
        // handle filtered list
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Upload Data

```javascript
const data = ...
client.putData('bindings/foo/bar', data)
    .then(({version}) => {
        // Handle success
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Get Data

```javascript
client.getData('bindings/foo/bar')
    .then((data) => {
        // Handle data
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Delete Data

```javascript
client.deleteData('bindings/foo/bar')
    .then(({version}) => {
        // Handle success
        ...
    })
    .catch((err) => {
        // Handle error
        ...
    })
```

### Proxy Client-Side Policy Checks

The Styra Run client can produce a HTTP request handler that proxies browser/client-side policy queries to Styra Run. This proxy is compatible with, and necessary for, the [Styra Run js SDK](https://github.com/StyraInc/styra-run-sdk-js).

```javascript
import {Router} from 'express'

const router = Router()

router.post('/authz', client.proxy(onProxy: async (req, res, path, input) => {
    return {
            ...input,
            subject: req.subject, // Add subject from session
        }
    }))

export default {
  router
}
```

The `proxy()` function takes a callback function as argument, and returns a request handling function. The provided callback function takes as arguments the incoming HTTP `Request`, the outgoing HTTP `Response`, the `path` of the queried policy, and the, possibly incomplete, `input` document for the query. The callback must return an updated version of the provided `input` document.

### RBAC Management API

The Styra Run client can produce a HTTP request handler providing the RBAC management API necessary for the RBAC management widget provided by the [Styra Run js SDK](https://github.com/StyraInc/styra-run-sdk-js).

```javascript
router.all('/rbac/*', styra.manageRbac(async (req) => {
    return {subject: req.auth.subject, tenant: req.auth.tenant}
}))
```

The `manageRbac(createInput, getUsers, onSetBinding, pageSize)` function returns a request handling function, and takes the following arguments:

| Name                               | Type       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
|------------------------------------|------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `createInput(request)`             | `callback` | A callback function that takes a single argument: `request`, the incoming HTTP `Request`. This callback must return a dictionary representing the `input` document for any necessary policy check. This document should contain the following two attributes: `subject`, a `string` representing the subject of the user session with which the request was made; and `tenant`, a `string` representing the tenant of the user session with which the request was made. Defaults to a function that returns an empty document `{}`. |
| `getUsers(offset, limit, request)` | `callback` | A callback function that must return a list of user IDs, and takes three arguments: `offset`, an integer index for where in the list of users to start enumerating; and `limit`, an integer number of users to enumerate, starting at `offset`; and the incoming HTTP `request`. If `limit` is `0`, no upper limit should be applied to the number of returned users. Defaults to a function that returns an empty list `[]`.                                                                                                       |
| `onSetBinding(id, roles, request)` | `callback` | A callback function that is called when a binding is about to be upserted. It takes three arguments: `id`, the id of the binding's user; `roles`, the roles this binding will apply to the user; and `request`, the incoming HTTP request. This callback must return a `boolean`, where `true` signals that the binding may be applied, and `false` signals that it must not. When called, implementations may create new users if necessary. Defaults to a function returning `true`.                                              |
| `pageSize`                         | `integer`  | The number of bindings allowed per page when enumerating bindings.                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

#### Endpoints

The RBAC API exposes the following endpoints:

| Path                             | Method | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
|----------------------------------|--------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `<API route>/roles`              | `GET`  | Get a list of available roles. Returns a json list of strings; e.g. `["ADMIN","VIEWER"]`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `<API route>/user_bindings`      | `GET`  | Get user to role bindings. Returns a list of objects, where each entry has two attributes: the `id` of the user; and their `roles`, as a list of role string identifiers; e.g. `[{"id": "alice", "roles": ["ADMIN"]}, {"id": "bob", "roles": ["VIEWER"]}]`. `GET` requests to this endpoint can include the `page` query attribute; an `integer` indicating what page of bindings to enumerate. The page size is defined when creating the API request handler on the server by calling `manageRbac()`. |
| `<API route>/user_bindings/<id>` | `PUT`  | Sets the role bindings of a user, where the `<id>` path component is the ID of the user. The request body must be a json list string role identifiers; e.g. `['ADMIN', 'VIEWER']`.                                                                                                                                                                                                                                                                                                                           |

/*

it would be nice to provide an example of a middleware to authorize protected endpoints
middlewares are Express specific I believe
example:

router.use(async function hasManagePermissions (req, res, next) {
  const isAllowed = await client.check(...);

  if (isAllowed) {
    next()
  } else {
    res.sendStatus(401)
  }
});

should also provide the min version of Node.js this SDK supports?
Node 18 is current and will be active LTS https://nodejs.org/en/about/releases/ when we probably release this SDK
*/