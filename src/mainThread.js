
/** @typedef {import('../index')}       BatchProcessor */
/** @typedef {import('worker_threads')} WorkerThreads  */

/**
 * Callback for handling data returned from a worker execution
 * @callback executeCallback
 * @property {*} iterated
 * @property {*} result
 */

/**
 * @typedef {Object} WorkerMessage
 * @property {String} type - complete, successful, failed, or error
 * @property {*} iterated - the object of the current task
 * @property {*} details - information about the message
 */

 const StatTracker = require('./statsTracker');
 const LogManager = require('./logManager');

module.exports = class MainThread {


    /**
     * Handles all interactions with the main thread
     * @param {BatchProcessor} batchProcessor 
     * @param {WorkerThreads} workerThreads 
     */
    constructor(batchProcessor, workerThreads) {
        /** @type {Worker[]}        */  this.workers = [];
        /** @type {Iterable}        */  this.iterable;
        /** @type {executeCallback} */  this.callback;
 
        this.processing = false;
        this.retryStarted = false;
        this.failedTasks = [];

        this.stats = new StatTracker();
        this.logManager = new LogManager(batchProcessor.config);
        this.Worker = workerThreads.Worker;
        this.batch = batchProcessor;
        this.threads = batchProcessor.config.threads;
        this.parallelProcesses = batchProcessor.config.parallelProcesses;
        this.workerScript = batchProcessor.config.filePath;
        this.retryFailed = batchProcessor.config.retryOnFail;
        this.timeout = batchProcessor.config.timeout;
        this.recentErrors = 0;
    }


    //////////////////////////////////////////////////////////////
    //   INITIAL SETUP METHODS


    /**
     * Attaches the main thread to the BatchProcessor
     * @param {BatchProcessor} batchProcessor 
     * @param {WorkerThreads} workerThreads 
     * @returns {MainThread} - An instance of this class
     */
     static isMain(batchProcessor, workerThreads) {
        if (!workerThreads.isMainThread) return null;
        return new this(batchProcessor, workerThreads);
    } 


    /**
     * Defines the iterable object (most likely an array) for the BatchProcessor
     * Each item will be passed to worker threads for use with the execute function
     * @param {Iterable} iterable - The list of items to be processed by workers
     */
    setIterable(iterable) {
        const main = this;
        if (iterable == undefined) throw new Error('You must provide and iterable object.');
        if (typeof(iterable)[Symbol.iterator] !== 'function') throw new Error('This object is not iterable.');
        main.iterable = iterable;
    }


    /**
     * Defines a callback function for handling the result of a completed worker execution
     * @param {executeCallback} callback - Executes after the main thread receives a "complete" message
     */
    setWorkerCallback(callback) {
        const main = this;
        if (callback == undefined) throw new Error('You must provide a callback function.');
        if (typeof(callback) != 'function') throw new Error('The callback must be a function.');
        main.callback = callback;
    }


    //////////////////////////////////////////////////////////////
    //   RUNTIME & USER CONTROLLED METHODS


    /**
     * Adds a worker thread for the Batch Processor
     * @returns {Number} The threadId of the new worker
     */
    addWorker() {
        const main = this;
        const worker = new main.Worker(main.workerScript);
        worker.sent = 0; worker.received = 0; worker.currentTasks = [];
        worker.on('error', err => { main.handleError(worker, err) });
        worker.on('exit', code => { main.handleExit(worker, code) });
        worker.on('message', message => { main.handleMessage(worker, message) });
        worker.on('messageerror', error => { main.handleError(worker, error) });
        worker.on('online', () => { main.handleOnline(worker) });
        main.workers.push(worker);
        main.manageIdleWorker(worker);
        return worker.threadId;
    }


    /**
     * Removes a worker thread from the Batch Processor
     * @param {String | undefined} [threadId] Optionally remove a specific worker thread id.
     * @param {Boolean | undefined} [immediate] Optionally remove the worker before it finishes the current iteration.
     * @returns {Boolean} If a worker was selected to be removed (The worker has not yet been removed)
     */
    removeWorker(threadId, immediate) {
        const main = this;
        let worker = threadId ? removeObjectFrom(main.workers, 'threadId', threadId) : main.workers.pop();
        if (!worker) return false;
        console.log('Stopping worker thread', worker.threadId);
        return immediate ? worker.terminate() : worker.stopping = true;
    }


    /**
     * Completes setup of the main thread and begins sending tasks to the worker threads
     * @param {Iterable} [iterable] (setIterable) The list of items to be processed by workers
     * @param {executeCallback} [callback] (setCallback) Function for handling the result of a completed worker execute
     */
    startWorking(iterable, callback) {
        const main = this;
        if (iterable) main.setIterable(iterable);
        if (callback) main.callback = callback;
        if (!main.iterable) throw new Error('You must provide a list of iterable items to process before startWorking.');
        main.stats.startTime = new Date();
        main.stats.totalTasks = main.iterable.length;
        main.processing = true;
        let currentWorkers = main.workers.length;
        const desiredWorkers = main.threads;
        while (currentWorkers < desiredWorkers) {
            main.addWorker();
            currentWorkers++;
        }
    }


    /**
     * Stops processing of additional tasks, but in a resumable state which can be continued with main.startWorking()
     * @param {Boolean} [immediate] Stop workers without waiting for completion of their current task(s) 
     */
    stopWorking(immediate) {
        const main = this;
        main.processing = false;
        const threadIds = main.workers.map(worker => worker.threadId);
        for (const id of threadIds) main.removeWorker(id, immediate);
    }


    //////////////////////////////////////////////////////////////
    //   MODULE CONTROLLED METHODS


    /**
     * Assigns additional tasks to workers or terminates the thread
     * Also checks if tasks can be retried when out of work
     * @param {Worker} worker
     */
    manageIdleWorker(worker) {
        const main = this;
        if (main.retryCondition()) main.beginRetry();
        if (main.taskCondition(worker)) {
            main.assignNextTask(worker);
        } else if (worker.received >= worker.sent) {
            console.log('Worker thread', worker.threadId, 'has finished.');
            worker.terminate();
        }
    }


    /**
     * Determines if a worker should continue processing tasks
     * @param {Worker} worker 
     * @returns {Boolean}
     */
    taskCondition(worker) {
        const main = this;
        return (
            main.processing && 
            main.iterable.length > 0 &&
            !worker.stopping
        );
    }


    /**
     * Determines if a retry of failed tasks should be started
     * @returns {Boolean}
     */
    retryCondition() {
        const main = this;
        return (
            main.iterable.length <= 0 &&
            main.processing &&
            main.retryFailed &&
            !main.retryStarted
        );
    }


    /**
     * Sends a taskMessage to the worker
     * If parallel processing is configured, deems the worker idle if not at desired capacity
     * @param {Worker} worker 
     */
    assignNextTask(worker) {
        const main = this;
        const nextIterable = main.iterable.pop();
        const taskMessage = {type: "workNext", iterableItem: nextIterable}
        worker.postMessage(taskMessage);
        worker.sent++;
        worker.currentTasks.push(nextIterable);
        const processing = worker.sent - worker.received;
        main.addTimeout(worker);
        if (processing < main.parallelProcesses) main.manageIdleWorker(worker);
    }


    addTimeout(worker) {
        const main = this;
        if (worker.timeout) clearTimeout(worker.timeout);
        worker.timeout = setTimeout(function() {
            for (const task of worker.currentTasks) main.onErrorMessage(worker, task, new Error('Worker thread timed out'));
            main.removeWorker(worker.threadId, true);
            main.addWorker();
        }, main.timeout);
    }


    /**
     * Attempts to process previously failed iterations
     */
    beginRetry() {
        const main = this;
        main.retryStarted = true;
        if (main.failedTasks.length > 0) {
            console.log(`Adding ${main.failedTasks.length} failed tasks back into the queue`);
            main.stats.totalTasks += main.failedTasks.length;
            main.iterable = [...main.failedTasks];
        }
    }
    

    /**
     * Handles events following the completion of an iteration/task
     * @param {*} worker 
     * @param {*} task 
     * @param {*} result 
     */
    onTaskCompletion(worker, task, result) {
        const main = this;
        removeValueFrom(worker.currentTasks, task);
        worker.received++;
        main.stats.processedTasks++;
        if (main.callback) main.callback(task, result);
        main.manageIdleWorker(worker);
    }


    /**
     * Handle success message sent from the worker execution
     * @param {Worker} worker 
     * @param {*} task 
     * @param {String} details 
     */
    onSuccessMessage(worker, task, details) {
        const main = this;
        main.stats.successful++;
        if (main.failedTasks.includes(task)) {
            main.logManager.logRetrySuccess(task, details);
            main.stats.failed--;
        } else {
            main.logManager.logSuccess(task, details);
        }
    }


    /**
     * Handles failure messages sent from the worker execution
     * @param {Worker} worker 
     * @param {*} task 
     * @param {String} details 
     */
    onFailureMessage(worker, task, details) {
        const main = this;
        if (main.retryStarted) {
            if (main.failedTasks.includes(task)) {
                // Retry failed, don't double log it
                return
            } else {
                // This is a new failure after retry has started. 
                main.stats.totalTasks++;
                main.iterable.push(task);
            }
        }
        main.failedTasks.push(task);
        main.logManager.logFailure(task, details);
        main.stats.failed++;
    }


    /**
     * Handles error messages sent from the worker execution
     * @param {worker} worker 
     * @param {*} task 
     * @param {Error} error 
     */
    onErrorMessage(worker, task, error) {
        const main = this;
        console.log(error.stack);
        main.stats.errors++
        main.logManager.logError(task, error);
    }


    //////////////////////////////////////////////////////////////
    //   MODULE EVENT HANDLERS


    /**
     * Event: 'online' - the worker thread has started executing JavaScript code.
     * @param {Worker} worker 
     */
    handleOnline(worker) {
        console.log("Worker thread", worker.threadId, "ready.");
    }


    /**
     * Event: 'exit' -  the worker has stopped.
     * @param {Worker} worker 
     * @param {Number} code
     */
    handleExit(worker, code) {
        console.log("Worker thread stopped.")
    }


    /**
     * Event: 'error' - the worker thread throws an uncaught exception, the worker is terminated.
     * @param {Worker} worker 
     * @param {Error} error 
     */
    handleError(worker, error) {
        error.message = "Thread crashed - " + error.message;
        const main = this;
        console.log("Worker thread", worker.threadId, "encountered an error.");
        worker.currentTasks.forEach(task => {
            main.onErrorMessage(worker, task, error);
            main.onFailureMessage(worker, task, error);
        });
        main.stats.processedTasks++;
        main.recentErrors++;
        setTimeout(() => main.recentErrors--, 5000);
        if (main.recentErrors > 5) throw new Error('Five worker threads have crashed within 5 seconds. Canceling execution');
        main.addWorker();
    }


    /**
     * Event: 'message' - worker thread has invoked parentPort.postMessage().
     * @param {Worker} worker 
     * @param {WorkerMessage} message 
     */
    handleMessage(worker, message) {
        const main = this;
        try {
            if (!message.type) throw new Error('Received invalid message - ' + message);
            if (message.type == "complete") return main.onTaskCompletion(worker, message.iterated, message.details);
            if (message.type == "successful") return main.onSuccessMessage(worker, message.iterated, message.details);
            if (message.type == "failed") return main.onFailureMessage(worker, message.iterated, message.details);
            if (message.type == "error") return main.onErrorMessage(worker, message.iterated, message.details);
            throw new Error('Unknown message type - ' + message.type);
        } catch(err) {
            console.log('There was an unexpected error while handling a worker message.', err.stack);
        }
    }

}


//////////////////////////////////////////////////////////////
//   HELPER FUNCTIONS

function removeObjectFrom(array, property, value) {
    for (let i=0; i<array.length; i++) {
        if (array[i][property] == value) {
            return array.splice(i, 1)[0];
        }
    }
    return null;
}

function removeValueFrom(array, value) {
    const index = array.indexOf(value);
    if (index > -1) array.splice(index, 1);
    return index != -1;
  }
