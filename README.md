# The Styra Run Node.js SDK

## How to Install

In your package.json:
```json
{
    "dependencies": {
        "oz": "github:StyraInc/styra-run-sdk-node#main"
    }
}
```

On the command line:
```
npm install oz
```

## How to Use

### Instantiate an Oz Client

```javascript
const options = {
    host: 'app-test.styra.com',
    port: 443,
    https: true,
    pid: 'proj1',
    eid: 'env1',
    uid: 'user1',
    token: 'my_secret'
}
const client = StyraRun.New(options)
```

### Check

```javascript
const input = {...}
client.check('foo/bar/allowed', input)
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

### Allow

```javascript
const input = {...}
const maybeAllowedObject = ...
client.allowed('foo/bar/allowed', input, maybeAllowedObject)
    .then((allowedObject) => {
        // Do something with the allowed object
        ...
    })
    .catch((err) => {
        // Handle rejection
        ...
    })
```

### Filter

```javascript
const list = ["do", "re", "mi"]
const toInput = (item) => {
    return {note: item}
}
client.filterAllowed('foo/bar/allowed', list, toInput)
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

```javascript
import {Router} from 'express'

const router = Router()

router.post('/authz', client.proxy(async (req, res, input) => {
    return {
            ...input,
            subject: req.subject, // Add subject from session
        }
    }))

export default {
  router
}
```
