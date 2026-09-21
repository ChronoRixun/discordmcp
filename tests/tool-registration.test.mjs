import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { lifecycleTools } from '../build/lifecycle.js';

test('every advertised tool is unique and has a dispatch case, including new lifecycle tools', () => {
  const file = ts.createSourceFile('index.ts', readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const advertised = [], handled = [];
  function visit(node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(file) === 'tools' && ts.isArrayLiteralExpression(node.initializer)) {
      for (const entry of node.initializer.elements) {
        if (ts.isSpreadElement(entry)) {
          assert.equal(entry.expression.getText(file), 'lifecycleTools');
          advertised.push(...lifecycleTools.map(t => t.name));
        } else {
          assert.ok(ts.isObjectLiteralExpression(entry));
          const name = entry.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(file) === 'name');
          assert.ok(name && ts.isStringLiteral(name.initializer));
          advertised.push(name.initializer.text);
        }
      }
    }
    if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression)) handled.push(node.expression.text);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(advertised.length, 51);
  assert.equal(new Set(advertised).size, advertised.length);
  assert.deepEqual([...advertised].sort(), [...handled].sort());
});
