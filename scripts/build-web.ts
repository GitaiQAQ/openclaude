import { $ } from 'bun'

void $

const result = await Bun.build({
  entrypoints: ['./src/web/App.tsx'],
  outdir: './dist/web',
  target: 'browser',
  format: 'esm',
  splitting: true,
  sourcemap: 'external',
  minify: false,
  external: [
    'fs', 'path', 'crypto', 'os', 'child_process', 'net', 'tls',
    '@grpc/grpc-js', '@grpc/proto-loader',
  ],
})

if (!result.success) {
  console.error('Build failed:', result.logs)
  process.exit(1)
}
console.log('Web build complete:', result.outputs.map(o => o.path))
