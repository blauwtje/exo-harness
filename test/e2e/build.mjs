import { execFileSync } from 'node:child_process';

export default function build() {
  execFileSync('npx', ['vite', 'build', '--logLevel', 'error'], { stdio: 'inherit' });
}
