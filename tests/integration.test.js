import {exec} from "child_process";
import TestServer from "./test-server.js";

describe("Integration tests", () => {
  it("pass", async () => {
    const server = new TestServer()
    await server.start()

    const process = await asyncExec("cd ./styra-run-sdk-tests && make test")

    expect(process.proc.exitCode).withContext(process.stdout).toBe(0)

    await server.stop()
  }, 30_000)
})

async function asyncExec(command) {
  return new Promise((resolve, reject) => {
    let proc = exec(command, (err, stdout, stderr) => {
      if (err && !stderr) {
        reject(err)
      } else {
        resolve({proc, stdout, stderr})
      }
    })
  })
}
