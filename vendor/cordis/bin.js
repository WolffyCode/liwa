#!/usr/bin/env node

import { Context } from '@liwa/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@liwa/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@liwa/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
