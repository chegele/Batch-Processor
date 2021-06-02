
/** @typedef {import('../index')}       BatchProcessor */
/** @typedef {import('worker_threads')} WorkerThreads  */

/**
 * @typedef {Object} MainMessage
 * @property {String} type - workNext
 * @property {*} iterableItem - the object of the current task
 */

module.exports = class WorkerThread {


    /**
     * Handles all interactions for worker threads
     * @param {BatchProcessor} batchProcessor 
     * @param {WorkerThreads} workerThreads 
     */
    constructor(batchProcessor, workerThreads) {
        const worker = this;
        worker.batch = batchProcessor;
        worker.main = workerThreads.parentPort;
        worker.main.on('message', message => { worker.handleMessage(message) });
        worker.ready = false;
        worker.queue = [];
    }


    //////////////////////////////////////////////////////////////
    //   INITIAL SETUP METHODS
    

    /**
     * Attaches the worker thread to the BatchProcessor
     * @param {BatchProcessor} batchProcessor 
     * @param {WorkerThreads} workerThreads 
     * @returns {WorkerThread} - An instance of this class
     */
    static isWorker(batchProcessor, workerThreads) {
        if (workerThreads.isMainThread) return null;
        return new this(batchProcessor, workerThreads);
    }


    //////////////////////////////////////////////////////////////
    //   RUNTIME & USER CONTROLLED METHODS


    /**
     * Sends a success message to the main thread
     * Used for statistics and logging execution results
     * @param {*} iterated - The iteratedObject for this execution 
     * @param {String} [details] - Any noteworthy details of the success
     */
    recordSuccess(iterated, details) {
        this.sendMessage('successful', iterated, details);
    }


    /**
     * Sends a failed message to the main thread
     * Used for statistics and logging execution results
     * @param {*} iterated - The iteratedObject for this execution 
     * @param {String} [details] - Any noteworthy details of the failure
     */
    recordFailure(iterated, details) {
        this.sendMessage('failed', iterated, details);
    }


    /**
     * Sends a error message to the main thread
     * Used for statistics and logging execution results
     * @param {*} iterated - The iteratedObject for this execution 
     * @param {Error | String} error - The error encountered during execution
     */
    recordError(iterated, error) {
        if (!error.stack) error = new Error(error);
        this.sendMessage('error', iterated, error);
    } 


    //////////////////////////////////////////////////////////////
    //   MODULE CONTROLLED METHODS


    /**
     * Called by the BatchProcessor once setup is complete
     * This is needed to make sure tasks are not lost while the worker thread is being prepared
     */
    startWorking() {
        const worker = this;
        worker.ready = true;
        for (const iterableItem of worker.queue) worker.processTask(iterableItem);
    }


    /**
     * Triggers the user defined execution method
     * Sends the result to the main thread
     * @param {*} iterableItem - The item to be processed in this iteration
     */
    async processTask(iterableItem) {
        const worker = this;
        const result = await worker.batch.execute(iterableItem);
        worker.completeIteration(iterableItem, result);
    }


    /**
     * Sends a formatted message to the main thread
     * @param {String} type The message type
     * @param {*} iterated The object of this task/iteration
     * @param {String} details Additional details
     */
    sendMessage(type, iterated, details) {
        const worker = this; 
        const validTypes = ['complete', 'successful', 'failed', 'error'];
        if (!validTypes.includes(type)) throw new Error(`${type} is not a valid worker message type.`);
        const message = {type, iterated, details};
        worker.main.postMessage(message);
    }


    /**
     * Triggered at the end of a iteration execution
     * Used to report the results to the main thread and request a new task
     * @param {*} iterated The object of this task/iteration
     * @param {*} details The results returned from the execute method
     */
    completeIteration(iterated, details) {
        this.sendMessage('complete', iterated, details);
    }


    //////////////////////////////////////////////////////////////
    //   MODULE EVENT HANDLERS

    /**
     * Currently there is only one message type - used to assign work
     * Event: 'message' - emitted for any incoming message
     * @param {MainMessage} message 
     */
    handleMessage(message) {
        const worker = this;
        if (message.type != 'workNext') throw new Error('Unknown message type from main thread.');
        if (!message.iterableItem) throw new Error('No iterableItem in workNext message.');
        const next = message.iterableItem;
        worker.ready ? worker.processTask(next) : worker.queue.push(next);
    }
}

//////////////////////////////////////////////////////////////
//   HELPER FUNCTIONS