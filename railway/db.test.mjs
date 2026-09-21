import test from 'node:test';import assert from 'node:assert/strict';import {postgresSql} from './db.mjs';
test('converts positional placeholders for postgres',()=>assert.equal(postgresSql('SELECT * FROM x WHERE a=? AND b=?'),'SELECT * FROM x WHERE a=$1 AND b=$2'));
