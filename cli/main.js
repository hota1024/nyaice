#!/usr/bin/env node
/* eslint-disable no-console */
const chalk = require('chalk');
const cli = require('cac')('nyaice');
const path = require('path');
const fsStreams = require('fs');
const fs = require('fs/promises');
const unzip = require('unzipper');
const axios = require('axios');
const pkg = require('../package.json');
const fastify = require('fastify')();
fastify.register(require('@fastify/static'), {
    root: path.join(__dirname, '../build'),
    prefix: '/'
});

cli.command('[project id|project url|.sb3|.zip|project dir]', 'project id or url or .sb3 or .zip or project dir');

cli.option('--port <port>', 'server port', {
    default: 3000
});

cli.option('--editor', 'open editor');

cli.help();
cli.version(pkg.version);

const SCRATCH_PROJECT_URL_REGEXP = /^https?:\/\/scratch\.mit\.edu\/projects\/(\d+)/;
const SCRATCH_PROJECT_ID_REGEXP = /^(\d+)/;
const TMP_DIR = path.join(__dirname, 'tmp');

const main = async () => {
    await fs.rm(TMP_DIR, {recursive: true}).catch(() => {});
    await fs.mkdir(TMP_DIR);

    const parsed = cli.parse();

    if (parsed.options.help) {
        return;
    }

    const selector = parsed.args[0];

    if (typeof selector === 'undefined') {
        console.log(chalk.red`[error] no project specified(use --help for help)`);
        process.exit();
    }

    console.log(chalk.yellow`===== nyaice v${pkg.version} =====`);

    let id = null;
    let title = 'unknown';
    let projectJson = null;
    let respondAsset = null;
    let editor = parsed.options.editor;

    const urlMatches = selector.match(SCRATCH_PROJECT_URL_REGEXP);
    const idMatches = selector.match(SCRATCH_PROJECT_ID_REGEXP);

    if (urlMatches) {
        id = urlMatches[1];
    } else if (idMatches) {
        id = idMatches[1];
    }
    
    if (id) {
        console.log(chalk.cyan`[fetch] fetching project ${id}`);
        const {data: projectMeta} = await axios.get(`https://trampoline.turbowarp.org/proxy/projects/${id}`);
        const res = await axios.get(`https://projects.scratch.mit.edu/${id}/?token=${projectMeta.project_token}`);
        projectJson = res.data;
        title = projectMeta.title;
        console.log(chalk.cyan`[fetch] fetched`);

        // eslint-disable-next-line no-shadow
        respondAsset = async (res, id) => {
            res.redirect(`https://assets.scratch.mit.edu/internalapi/asset/${id}/get/`);
        };
    } else {
        const stat = await fs.stat(selector);
        const isDirectory = stat.isDirectory();
        const basePath = isDirectory ? selector : TMP_DIR;

        const load = async () => {
            try {
                if (isDirectory) {
                    console.log(chalk.cyan`[directory] found directory ${selector}`);
                } else {
                    console.log(chalk.cyan`[unzip] found file ${selector}`);
                    console.log(chalk.cyan`[unzip] trying to unzip`);
                    // eslint-disable-next-line no-undef
                    await new Promise(r => {
                        fsStreams.createReadStream(selector)
                            .pipe(unzip.Extract({path: TMP_DIR}))
                            .on('close', () => {
                                r();
                            });
                    }).catch(() => {
                        console.log(chalk.red`[unzip] cannot unzip file: ${selector}`);
                        process.exit(1);
                    });
                    console.log(chalk.cyan`[unzip] unzipped to ${basePath}`);
                }

                console.log(chalk.cyan`[project.json] trying to read project.json`);
                const jsonBuffer = await fs.readFile(path.join(basePath, 'project.json')).catch(() => {
                    console.log(chalk.red`[project.json] cannot find project.json in ${basePath}`);
                    process.exit(1);
                });
                projectJson = JSON.parse(jsonBuffer.toString());
                console.log(chalk.cyan`[project.json] read project.json`);

                title = path.basename(selector);

                // eslint-disable-next-line no-shadow
                respondAsset = async (res, id) => {
                    const buffer = await fs.readFile(path.join(basePath, id));
                    res.send(buffer);
                };
                
            } catch (error) {
                // eslint-disable-next-line no-console
                console.log(chalk.red`Cannot find project: ${selector}`);
                process.exit(1);
            }
        };

        await load();
    }

    fastify.get('/projects/server', (req, res) => {
        res.send(projectJson);
    });

    fastify.get('/assets/internalapi/asset/:id/get/', (req, res) => {
        respondAsset(res, req.params.id);
    });

    fastify.listen({
        port: parsed.options.port
    });

    let url = editor ? `http://localhost:${parsed.options.port}?editor=true` : `http://localhost:${parsed.options.port}`;
    console.log(chalk.green`project loaded: ${title}`);
    console.log(chalk.cyan`server started at ${url}`);
};

main();
