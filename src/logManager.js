
const path = require('path');
const fs = require('fs-extra');

module.exports = class LogManager {


    /**
     * Manages the log files and interaction on the Batch Processor
     * @param {import('../index').Config} config 
     */
    constructor(config) {
        if (!config.logLocation) return;
        this.iterableName = config.iterableName || 'task';
        this.logPath = path.resolve(config.logLocation);
        this.processing = false;
        this.logQueue = [];
        this.successFile = path.join(this.logPath, 'batch-success.log');
        this.failureFile = path.join(this.logPath, 'batch-failure.log');
        this.errorsFile = path.join(this.logPath, 'batch-errors.log');
        ensureFile(this.successFile);
        ensureFile(this.failureFile);
        ensureFile(this.errorsFile);
    }


    //////////////////////////////////////////////////////////////
    //   USER CONTROLLED METHODS


    /**
     * Adds a success event to the log queue
     * @param {*} iterated 
     * @param {String} details 
     */
    logSuccess(iterated, details) {
        const logManager = this;
        logManager.addToQueue('success', {iterated, details});
    }
    

    /**
     * Adds a failure event to the log queue
     * @param {*} iterated 
     * @param {String} details 
     */
    logFailure(iterated, details) {
        const logManager = this;
        logManager.addToQueue('failure', {iterated, details});
    }


    /**
     * Adds an error event to the log queue
     * @param {*} iterated 
     * @param {Error} error 
     */
    logError(iterated, error) {
        const logManager = this;
        logManager.addToQueue('error', {iterated, error: error.stack});
    }


    /**
     * Adds a remove failure event to the log queue
     * Adds a successful event to the log queue
     * @param {*} iterated 
     * @param {String} details 
     */
    logRetrySuccess(iterated, details) {
        const logManager = this;
        logManager.addToQueue('rmFailure', {iterated});
        logManager.addToQueue('success', {iterated, details});
    } 


    //////////////////////////////////////////////////////////////
    //   MODULE CONTROLLED METHODS


    /**
     * Adds a logging task to the queue
     * This is needed to prevent multiple threads from writing at the same time
     * @param {String} type - The event type 
     * @param {Object} data - The logging details to include 
     */
    addToQueue(type, data) {
        const logManager = this;
        if (!logManager.logPath) return;
        logManager.logQueue.push({type, data});
        if (!logManager.processing) logManager.processQueue();
    }


    /** Processes logging events in sequential order until there are none left */
    async processQueue() {
        const logManager = this;
        logManager.processing = true;
        for (const logTask of logManager.logQueue) {
            logManager.logQueue.shift();
            try {
                const data = logTask.data;
                if (logTask.type == "success") logManager.processSuccess(data.iterated, data.details);
                if (logTask.type == "failure") logManager.processFailure(data.iterated, data.details);
                if (logTask.type == "error") logManager.processError(data.iterated, data.error);
                if (logTask.type == "rmFailure") logManager.processRmFailure(data.iterated);
            } catch (err) {
                console.log('There was an error logging an event - ', logTask);
                console.log(err.stack);
            }
        }
        logManager.processing = false;
    }


    /**
     * Appends a success event to the success log
     * @param {*} iterated 
     * @param {Object} details 
     */
    async processSuccess(iterated, details) {
        const logManager = this;
        const line = `{"${logManager.iterableName}": "${iterated}", "details": "${details}"}\n`;
        await appendFile(logManager.successFile, line);
    }
    

    /**
     * Appends a failure event to the failure log
     * @param {*} iterated 
     * @param {Object} details 
     */
    async processFailure(iterated, details) {
        const logManager = this;
        const line = `{"${logManager.iterableName}": "${iterated}", "details": "${details}"}\n`;
        await appendFile(logManager.failureFile, line);
    }
    

    /**
     * Appends a error event to the errors log
     * @param {*} iterated 
     * @param {Error.stack} stack 
     */
    async processError(iterated, stack) {
        const logManager = this;
        const line = `{"${logManager.iterableName}": "${iterated}", "error": "${stack}"}\n\n`;
        await appendFile(logManager.errorsFile, line);
    }
    
    
    /**
     * Removes a failed event from the failed file
     * @param {*} iterated 
     */
    async processRmFailure(iterated) {
        const logManager = this;
        const lines = await readFile(logManager.failureFile, true);
        let index = -1;
        for (let i=0; i<lines.length; i++) {
            try {
                const line = JSON.parse(lines[i]);
                if (line[logManager.iterableName] == iterated) {
                    index = i;
                    break;
                }
            } catch (err) {
                // Invalid JSON line in the log
            }
        }
        if (index == -1) return;
        lines.splice(index, 1);
        await writeFile(logManager.failureFile, lines.join('\n'));
    }
    
}

//////////////////////////////////////////////////////////////
//   HELPER FUNCTIONS


/**
 * Validates that a file directory exists
 * Creates a file if it does not exist
 * @param {String} filePath
 */
function ensureFile(filePath) {
    const dir = path.dirname(filePath);
    const dirExists = fs.pathExistsSync(dir);
    if (!dirExists) throw new Error('Unable to create file in the specified path - ' + dir);
    fs.ensureFileSync(filePath);
}


/**
 * Appends a new line to a file
 * @param {String} filePath 
 * @param {String} line 
 */
async function appendFile(filePath, line) {
    await fs.appendFile(filePath, line);
}


/**
 * Writes/overwrites content to a file
 * @param {String} filePath 
 * @param {String} data 
 */
async function writeFile(filePath, data) {
    await fs.writeFile(filePath, data);
}


/**
 * Reads the contents of a file
 * @param {String} filePath 
 * @param {Boolean} toArray 
 * @returns {String | String[]}
 */
async function readFile(filePath, toArray) {
    const result = await fs.readFile(filePath, 'utf-8');
    return toArray ? result.split('\n') : result;
}