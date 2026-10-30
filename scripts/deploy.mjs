#!/usr/bin/env node
/**
 * 一键部署到 GitHub Pages（只依赖 Node 18+ 内置能力，无需 git / gh）
 *
 * 用法：
 *   GITHUB_TOKEN=ghp_xxx node scripts/deploy.mjs
 *   GITHUB_TOKEN=ghp_xxx REPO_NAME=weiqi node scripts/deploy.mjs
 *
 * 说明：
 *   1. 通过 GitHub REST API 创建/更新仓库（公开仓库）；
 *   2. 用 Git Data API 提交当前目录下的静态文件（适合 github.com 不稳定而 api.github.com 可用的网络环境）；
 *   3. 开启 GitHub Pages（main 分支根目录），等待构建完成并输出访问地址。
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://api.github.com';
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
const REPO_NAME = process.env.REPO_NAME || 'weiqi';
const COMMIT_MESSAGE = process.env.COMMIT_MESSAGE || 'feat: 围棋在线对弈';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const IGNORED = new Set(['.git', 'node_modules', '.DS_Store', 'shots', 'dist']);

if (!TOKEN) {
  console.error('缺少 GITHUB_TOKEN。请先创建一个具有 repo 权限的 Personal Access Token。');
  process.exit(1);
}

function log(...args) {
  console.log('[deploy]', ...args);
}

async function api(method, endpoint, body, { allowStatus = [] } = {}) {
  const res = await fetch(API + endpoint, {
    method,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'weiqi-deploy',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok && !allowStatus.includes(res.status)) {
    const message = (data && data.message) || text;
    const err = new Error(`${method} ${endpoint} → ${res.status} ${message}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return { status: res.status, data };
}

async function walk(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await walk(abs, rel));
    } else if (entry.isFile()) {
      files.push({ abs, rel });
    }
  }
  return files;
}

async function main() {
  const me = (await api('GET', '/user')).data;
  const owner = me.login;
  log(`已登录：${owner}`);

  let repo;
  const existing = await api('GET', `/repos/${owner}/${REPO_NAME}`, null, { allowStatus: [404] });
  if (existing.status === 404) {
    repo = (await api('POST', '/user/repos', {
      name: REPO_NAME,
      description: '围棋在线对弈 · 9/13/19 路 · 人机与双人 · 终局数子 · 纯静态',
      homepage: `https://${owner}.github.io/${REPO_NAME}/`,
      private: false,
      has_issues: true,
      has_wiki: false,
      has_projects: false
    })).data;
    log(`已创建仓库 ${owner}/${REPO_NAME}`);
  } else {
    repo = existing.data;
    log(`仓库已存在 ${owner}/${REPO_NAME}`);
  }

  const files = await walk(ROOT);
  log(`待上传文件 ${files.length} 个`);

  const tree = [];
  for (const file of files) {
    const content = await readFile(file.abs);
    const blob = (await api('POST', `/repos/${owner}/${REPO_NAME}/git/blobs`, {
      content: content.toString('base64'),
      encoding: 'base64'
    })).data;
    tree.push({ path: file.rel, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const treeRes = (await api('POST', `/repos/${owner}/${REPO_NAME}/git/trees`, { tree })).data;

  let parents = [];
  const ref = await api('GET', `/repos/${owner}/${REPO_NAME}/git/ref/heads/main`, null, { allowStatus: [404, 409] });
  if (ref.status === 200 && ref.data && ref.data.object) {
    parents = [ref.data.object.sha];
    log(`基于已有提交 ${ref.data.object.sha.slice(0, 7)} 更新`);
  }

  const commit = (await api('POST', `/repos/${owner}/${REPO_NAME}/git/commits`, {
    message: COMMIT_MESSAGE,
    tree: treeRes.sha,
    parents
  })).data;
  log(`已创建提交 ${commit.sha.slice(0, 7)}`);

  if (parents.length) {
    await api('PATCH', `/repos/${owner}/${REPO_NAME}/git/refs/heads/main`, { sha: commit.sha, force: true });
  } else {
    await api('POST', `/repos/${owner}/${REPO_NAME}/git/refs`, { ref: 'refs/heads/main', sha: commit.sha });
  }

  /* 开启 GitHub Pages */
  const pages = await api('GET', `/repos/${owner}/${REPO_NAME}/pages`, null, { allowStatus: [404] });
  if (pages.status === 404) {
    await api('POST', `/repos/${owner}/${REPO_NAME}/pages`, {
      source: { branch: 'main', path: '/' }
    });
    log('已开启 GitHub Pages（main 分支根目录）');
  } else {
    log('GitHub Pages 已开启');
  }

  const url = `https://${owner}.github.io/${REPO_NAME}/`;
  log('等待 Pages 构建...');

  let build = null;
  for (let i = 0; i < 40; i += 1) {
    await new Promise((r) => setTimeout(r, 6000));
    const latest = await api('GET', `/repos/${owner}/${REPO_NAME}/pages/builds/latest`, null, { allowStatus: [404] });
    build = latest.status === 200 ? latest.data : null;
    if (build) {
      log(`构建状态：${build.status}`);
      if (build.status === 'built') break;
      if (build.status === 'errored') {
        console.error('Pages 构建失败：', build.error && build.error.message);
        break;
      }
    }
  }

  console.log('\n✅ 仓库：https://github.com/' + owner + '/' + REPO_NAME);
  console.log('🌐 访问：' + url);
  if (build && build.status !== 'built') {
    console.log('（Pages 可能仍在构建，通常 1–2 分钟后可用）');
  }
}

main().catch((err) => {
  console.error('\n部署失败：', err.message);
  if (err.status === 401) console.error('提示：Token 无效或已过期。');
  if (err.status === 403) console.error('提示：Token 权限不足（需要 repo + Pages 写权限），或触发了 API 频率限制。');
  if (err.status === 422) console.error('提示：仓库名可能已被占用，可设置 REPO_NAME 换一个名字。');
  process.exit(1);
});
