import fs from 'fs';
import isEmpty from 'lodash/lang/isEmpty';
import sass from 'sass.js';
import path from 'path';
import resolvePath from './resolve-path';
import escape from './escape-text';

const isWin = process.platform.match(/^win/);

const loadFile = file => {
  return new Promise((resolve, reject) => {
    fs.readFile(file, { encoding: 'UTF-8' }, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });
};

const fromFileURL = url => {
  const address = url.replace(/^file:(\/+)?/i, '');
  return !isWin ? `/${address}` : address.replace(/\//g, '\\');
};

// intercept file loading requests (@import directive) from libsass
sass.importer((request, done) => {
  // Currently only supporting scss imports due to
  // https://github.com/sass/libsass/issues/1695
  let content;
  let resolved;
  let readImportPath;
  let readPartialPath;
  resolvePath(request)
    .then(importUrl => {
      resolved = importUrl;
      const partialUrl = importUrl.replace(/\/([^/]*)$/, '/_$1');
      readImportPath = fromFileURL(importUrl);
      readPartialPath = fromFileURL(partialUrl);
      return loadFile(readPartialPath);
    })
    .then(data => content = data)
    .catch(() => loadFile(readImportPath))
    .then(data => content = data)
    .then(() => done({ content, path: resolved }))
    .catch(() => done());
});

export default (loads, compileOpts) => {

  const stubDefines = loads.map(load => {
    return `${(compileOpts.systemGlobal || 'System')}\.register('${load.name}', [], false, function() {});`;
  }).join('\n');

  const compilePromise = load => {
    return new Promise((resolve, reject) => {
      const urlBase = `${path.dirname(load.address)}/`;
      const options = {
        style: sass.style.compressed,
        indentedSyntax: load.address.endsWith('.sass'),
        importer: { urlBase },
      };
      // Occurs on empty files
      if (isEmpty(load.source)) {
        return resolve('');
      }
      sass.compile(load.source, options, result => {
        if (result.status === 0) {
          let stubStart = `${(compileOpts.systemGlobal || 'System')}\.register('${load.name}', [], false, function() { return "`
          let stubEnd = `";});`
          resolve(stubStart+escape(result.text)+stubEnd);
        } else {
          reject(result.formatted);
        }
      });
    });
  };
  return new Promise((resolve, reject) => {
    // Keep style order
    Promise.all(loads.map(compilePromise))
    .then(
      response => resolve(response.join('\n')),
      reason => reject(reason));
  });
};
