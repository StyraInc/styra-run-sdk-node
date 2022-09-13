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
import StyraRun from "styra-run-sdk-node"

// Options are pulled from the environment
const client = StyraRun(process.env.RUN_URL, process.env.RUN_TOKEN)
```

### Query

Makes a policy rule query, returning the result object: `{"result": any}`

```javascript
const input = ...
const {result:data} = await client.query('foo/bar/allowed', input)
if (data) {
    // Handle policy result
    ...
} else {
    // Handle policy reject
}
```

### Check

Makes a policy rule query, returning `true` if the result object equals `{"result": true}`, `false` otherwise.

```javascript
const input = ...
if (await client.check('foo/bar/allowed', input)) {
    // Handle policy accept
    ...
} else {
    // Handle policy reject
}
```

### Assert

Makes a policy rule query, throwing an exception if the result document doesn't equal `{"result": true}`.
By default, the `assert()` function requires the policy decision to contain `{"result": true}`.

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

Filters a provided list.

```javascript
import StyraRun, { defaultPredicate } from "run-sdk"

const list = ["do", "re", "mi"]
// Creates a unique input document for each list item, so the policy rule can differentiate between them and make decissions accordingly.
const toInput = (item) => {
    return {note: item}
}

// The default predicate asserts the policy decision is equal to `{"result": true}`
const filteredList = await client.filter(list, defaultPredicate, 'foo/bar/allowed', list, toInput)
```

### Upload Data

```javascript
const data = ...
await client.putData('bindings/foo/bar', data)
```

### Get Data

```javascript
const {result} = await client.getData('bindings/foo/bar')
```

### Delete Data

```javascript
await client.deleteData('bindings/foo/bar')
```

### Proxy Client-Side Policy Checks

The Styra Run client can produce a HTTP request handler that proxies browser/client-side policy queries to Styra Run. This proxy is compatible with, and necessary for, the [Styra Run js SDK](https://github.com/StyraInc/styra-run-sdk-js).

```javascript
import {Router} from 'express'

const router = Router()

router.post('/authz', client.proxy(onProxy: async (req, path, input) => {
    return {
            ...input,
            subject: req.subject, // Add subject from session
        }
    }))
```

The `proxy()` function takes a callback function as argument, and returns a request handling function. The provided callback function takes as arguments the incoming HTTP `Request`, the `path` of the queried policy, and the - possibly incomplete - `input` document for the query. The callback must return an updated version of the provided `input` document.

#### Endpoint

The proxy API exposes the following endpoint:

| Path              | Method | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
|-------------------|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `<API endpoint>/` | `POST` | Proxies a set of policy queries to Styra Run. The request body must be a JSON object with one parameter: `items`, a list of query objects. A query object has two parameters: `path`, a string representing the path of the policy rule to query; and `input`, the input value to provide to the policy. This endpoint returns a JSON object with a `result` parameter, which contains a list of policy decision results; ordering reflects the list of incoming queries. |

### RBAC Management API

The Styra Run client can produce a HTTP request handler providing the RBAC management API necessary for the RBAC management widget provided by the [Styra Run js SDK](https://github.com/StyraInc/styra-run-sdk-js).

```javascript
import StyraRun, {Paginators} from "styra-run-sdk-node"

router.all('/rbac/*', styra.manageRbac({
  createAuthzInput: async (req) => {
    return {subject: req.auth.subject, tenant: req.auth.tenant}
  },
  getUsers: () => {
    return {result: ['alice', 'bob', 'cesar']}
  }
}))
```

The `manageRbac(createInput, getUsers, onSetBinding, pageSize)` function returns a request handling function, and takes the following arguments:

| Name                                   | Type       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|----------------------------------------|------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `createAuthzInput(request)`            | `callback` | A callback function that takes a single argument: `request`, the incoming HTTP `Request`. This callback must return an object representing the `input` document for any necessary authorization policy checks. This object should contain the following two attributes: `subject`, a `string` representing the subject of the user session with which the request was made; and `tenant`, a `string` representing the tenant of the user session with which the request was made. Defaults to a function that returns an empty document `{}`. |
| `getUsers(page, request)`              | `callback` | A callback function that takes two arguments: `page`, some opaque string representing the page of users to enumerate, defined by the callback; and the incoming HTTP `request`. If `limit` is `0`, no upper limit should be applied to the number of returned users. Defaults to a function that returns an empty list `[]`.  The callback is expected to return an object with two properties: `result`, a list of user identifier strings; and `page`, an opaque string describing the returned page of users.                              |
| `onGetRoleBinding(id, request)`        | `callback` | A callback function that is called when a binding is about to be retrieved. It takes two arguments: `id`, the id of the binding's user; and `request`, the incoming HTTP request. This callback must return a `boolean`, where `true` signals that the binding may be retrieved, and `false` signals that it must not. When called, implementations may create new users if necessary. Defaults to a function returning `true`.                                                                                                               |
| `onSetRoleBinding(id, roles, request)` | `callback` | A callback function that is called when a binding is about to be upserted. It takes three arguments: `id`, the id of the binding's user; `roles`, the roles this binding will apply to the user; and `request`, the incoming HTTP request. This callback must return a `boolean`, where `true` signals that the binding may be applied, and `false` signals that it must not. When called, implementations may create new users if necessary. Defaults to a function returning `true`.                                                        |
| `onDeleteRoleBinding(id, request)`     | `callback` | A callback function that is called when a binding is about to be deleted. It takes two arguments: `id`, the id of the binding's user; and `request`, the incoming HTTP request. This callback must return a `boolean`, where `true` signals that the binding may be deleted, and `false` signals that it must not. When called, implementations may remove existing users if necessary. Defaults to a function returning `true`.                                                                                                              |

#### Endpoints

The RBAC API exposes the following endpoints:

| Path                             | Method   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
|----------------------------------|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `<API route>/roles`              | `GET`    | Get a list of available roles. Returns a JSON object where the `result` property is a list of strings; e.g. `["ADMIN","VIEWER"]`.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `<API route>/user_bindings`      | `GET`    | Get user to role bindings. Returns JSON object where the `result` property is a list of objects, where each entry has two attributes: the `id` of the user; and their `roles`, as a list of role string identifiers; e.g. `[{"id": "alice", "roles": ["ADMIN"]}, {"id": "bob", "roles": ["VIEWER"]}]`. `GET` requests to this endpoint can include the `page` query attribute; an `integer` indicating what page of bindings to enumerate. The page size is defined when creating the API request handler on the server by calling `manageRbac()`. |
| `<API route>/user_bindings/<id>` | `PUT`    | Sets the role binding of a user, where the `<id>` path component is the ID of the user. The request body must be a json list string role identifiers; e.g. `['ADMIN', 'VIEWER']`.                                                                                                                                                                                                                                                                                                                                                                  |
| `<API route>/user_bindings/<id>` | `DELETE` | Removes the role binding of a user, where the `<id>` path component is the ID of the user.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

#### Pagination

The RBAC management API supports pagination when listing user bindings. To facilitate this, the `getUsers` callback takes a `page` string argument, describing the "page" of users to return; and returns an object containing a `page` string property, representing the "page" of users just returned; e.g. `{result: [...], page: "..."}`. 
These string values are opaque to this SDK, and no assumptions are made about their content. The HTTP API will accept the incoming `page` as a query parameter, which it then forwards to the callback. Similarly, it will emmit the returned `page` object parameter as part of the returned JSON response document. It is up to the HTTP API user (e.g. front-end) and the callback implementation to negotiate how the `page` values are formatted and used.
The `Paginators.makeIndexedPaginator(pageSize, producer, getTotalCount)` function constructs a simple index-based paginator where the `page` input is the numbered index of the page as a string, and the emitted `page` is a json document with two parameters: `index`, the index of the current page; and `of`, the total number of pages possible to retrieve. The provided `producer(offset, limit, request)` callback returns a list of string user identifiers, and takes three arguments: `offset`, the integer index from where in the total list of users to start enumeration; `limit`, an integer number of users to enumerate, starting at `offset`; and `request`, the incoming HTTP request. 
Optionally, the `getTotalCount(request)` callback can be included to inform the paginator about the total number of pages to be expected. It takes the incoming HTTP request as argument, and is expected to return the total number of users the `producer` callback can emmit. If this callback is not provided, the `of` parameter in the emitted `page` is omitted.

##### Example

Initialization:

```javascript
import StyraRun, {Paginators} from "styra-run-sdk-node"

const users = ['alice', 'bob', 'cesar', ...]

router.all('/rbac/*', styra.manageRbac({
  createAuthzInput: async (req) => {
    return {subject: req.auth.subject, tenant: req.auth.tenant}
  },
  getUsers: Paginators.makeIndexedPaginator(10, (offset, limit, req) => {
      if (limit === 0) {
        return users.slice(offset)
      }
      return users.slice(offset, offset + limit)
    },
    (req) => users.length)
}))
```

Request:

```
GET /api/rbac/user_bindings?page=2
```

Response:
```json
{"result": ["alice", "bob", ...], "page": {"index": 2, "of": 3}}
```


