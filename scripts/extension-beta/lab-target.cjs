// Exact pairs only. No caller-provided URL, compose project, container or production fallback.
const {execFileSync}=require("node:child_process"),assert=require("node:assert/strict");
const scope=process.env.READER_TEST_LAB||"beta";
if(!["beta","scope"].includes(scope))throw Error("Unknown disposable lab");
const project=scope==="scope"?"reader-scope-1123":"reader-ext-beta-1123";
const origin=scope==="scope"?"http://127.0.0.1:18483":"http://127.0.0.1:18383";
function container(role){
  if(!["api","worker"].includes(role))throw Error("Unknown fixture role");
  const name=`${project}-${role}-1`;
  assert.equal(execFileSync("docker",["inspect",name,"--format",'{{index .Config.Labels "com.docker.compose.project"}}/{{index .Config.Labels "com.docker.compose.service"}}'],{encoding:"utf8"}).trim(),project+"/"+role);
  return name;
}
function fixtureArgs(){return ["exec","-i","-e","SYNTHETIC_ORIGIN="+origin,container("api"),"python","-"];}
module.exports={project,origin,container,fixtureArgs};
