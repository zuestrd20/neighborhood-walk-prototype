// Development only: reuses the installed build tooling. End users need no npm install.
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
const dependencyRoot=process.env.NEIGHBORHOOD_NODE_MODULES||path.resolve(root,'node_modules');
const {build}=require(path.join(dependencyRoot,'esbuild'));
await build({absWorkingDir:root,entryPoints:['src/main.js'],outfile:'game.js',bundle:true,format:'iife',platform:'browser',target:['es2020'],minify:true,legalComments:'eof',nodePaths:[dependencyRoot],logLevel:'info'});
