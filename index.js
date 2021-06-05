
/**
 * @typedef {Object} Config configuration for the batch processor
 * @property {Number} threads - The number of worker threads to create for processing
 * @property {Number} parallelProcesses - The number of parallel iterations to run on each thread
 * @property {Boolean} [retryOnFail] - If the BatchProcessor should attempt processing failed tasks a second time
 * @property {Boolean} [autoStart] - If the BatchProcessor should start without the user calling main.startWorking()
 * @property {String} [logLocation] - The path for saving success, failure, and error logs
 * @property {String} [iterableName] - The singular term of the iterable items being processed
 * @property {Number} [timeout] - Timeout for execution - results in termination of the thread and creation of a new one. 
 */


const workerThreads = require('worker_threads');
const MainThreadManager = require('./src/mainThread.js');
const WorkerThreadManager = require('./src/workerThread.js');


module.exports = class BatchProcessor {


    /**
     * Attaches the BatchProcessor functionality to the sub class
     * @param {Config} config - The configuration for the Batch Processor
     * @param {String} filePath - The path to the subclass, used to create new instances of worker threads
     */
    async initialize(config, filePath) {
        try {

            // Attach the configuration, main thread, and worker thread
            this.config = config;
            this.config.filePath = config.filePath || filePath;
            this.main = MainThreadManager.isMain(this, workerThreads);
            this.worker = WorkerThreadManager.isWorker(this, workerThreads);
            
            // If this is the main thread instance, initialize and start sending tasks
            if (this.main) {
                await this.prepareMainThread();
                if (config.autoStart) this.main.startWorking();
            }  
            
            // If this is a worker thead instance, initialize and start processing tasks
            if (this.worker) {
                await this.prepareWorkerThread();
                this.worker.startWorking();
            }    

        } catch(err) {
            console.log('Error initalizing batch processor - ' + err.stack);
            throw err;
        }
    }


    /** You can override this method to complete work before the main thread starts */
    async prepareMainThread() { }


    /** You can override this method to complete work before each worker thread starts */
    async prepareWorkerThread() { }


    /**
     * The meat of the module. Inherit this class in another file and add an execute function
     * Your list of work will be automatically sent to this function to be processed on different threads
     * @param {*} item 
     */
    async execute(item) {
        throw new Error('You must override the execute method in ' + this.config.filePath);
    }

}

