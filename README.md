
# Batch Processor (Threaded)
A node.js framework for hiding worker-threads in the background. Manages concurrent processing on multiple threads and/or with parallel executions per thread. 

  
## Installation and use
```
npm i batch-thread-processor
```
```javascript
// Import the module
const BatchProcessor = require('batch-thread-processor');

// Decide on a configuration
const config = {
    threads: 4,
    parallelProcesses: 1,
    autoStart: true,
    retryOnFail: true,
    logLocation: './log/',
    iterableName: 'fileName'
};

// Extend the module on your own class
// In this example we will be processing images
module.exports = class MyBatchImageProcessor extends BatchProcessor {

    constructor() {
        super();
        this.initialize(config, __filename);
        // Use prepareMainThread as the constructor method for the main thread
        // Use prepareWorkerThread as the constructor for worker threads
    }

    // this will be ran once on the main thread which manages dispatching work to worker threads
    async prepareMainThread() {

        // Retrieve our iterable list here
        const fs = require('fs');
        const filesToProcess = await fs.promises.readDir('./FilesToConvert/');
        this.main.setIterable(filesToProcess);

        // Enable runtime stats logging to the console
        this.main.stats.autoLog(5);

        // Setup a callback for when some work completes
        this.main.setWorkerCallback((file, result) => {
            console.log("Finished converting an image");
            console.log("Old file", file);   // Example output [Old file myImage.png]
            console.log("New file", result); // Example output [New file myImage.jpg]
        });
    }

    // This will be ran once each time a thread is created
    async prepareWorkerThread() {
        // Setup dependencies that need to be available to processing threads
        this.imageConverter = require('./myImageConverter');
    }

    // This will be executed by worker threads
    async execute(file) {
        try {
            const convertedImage = await this.imageConverter.pngToJpg(file);
            this.worker.recordSuccess(file, "Successfully converted the image");
            return convertedImage;
        } catch(err) {
            this.worker.recordFailure(file, err.message);
        }
        
    }
}
```

  
## Explanation
The worker-threads module operates by creating multiple instances of a single file/script. The scripts will then pass messages to each threaded instance of itself to establish a workflow. All of the examples on the node api have the main thread and the worker thread logic in the same file, which is difficult to manage. This module instead separates the main thread, worker thread, and app logic into their own files. Class inheritance is then used to attach all of the needed functionality of worker-threads to your application, but in a way that is easier to understand and manage. After importing and extending this module you will be able to interface with worker-threads through three pre-defined functions, which you need to override as seen in the use example. 

### **prepareMainThread**
This function acts as a constructor for the main/managing thread. This is where you will want to compile your list of work that needs to be completed. For example, if you will be processing files you will be able to compile your list of file names/paths here. Additionally, this function will have access to the main property (this.main), which exposes the ability to control the module as it is running. 

### **prepareWorkerThread**
This functions will run each time a new thread is created. A good use of this function is to attach dependencies which the worker threads will need, but have no value being exposed to the main thread.

### **execute**
The location for your application / processing logic. This function will receive 1 parameter, which is a single iteration from the list set in the prepareMainThread function. This item will be available to you so that it can be processed however necessary. This function will continue to be called after each return until all of the configured iterable items have been executed with this function.

  
## Configuration
 - {Number} threads - The number of worker threads to create for processing
 - {Number} parallelProcesses - The number of parallel iterations to run on each thread
 - {Boolean} [retryOnFail] - If the BatchProcessor should attempt processing failed tasks a second time
 - {Boolean} [autoStart] - If the BatchProcessor should start without the user calling main.startWorking()
 - {String} [logLocation] - The path for saving success, failure, and error logs
 - {String} [iterableName] - The singular term of the iterable items being processed

  
## API
### Main thread  
Note: These endpoints are only accessible within prepareMainThread or outside of the subClass (myClass.main)  

**main.setIterable(iterable)** *- Defines the iterable object (most likely an array) for the BatchProcessor.*  
 Each item will be passed to worker threads for use with the execute function  
 @param {Iterable} iterable - The list of items to be processed by workers  

**main.setWorkerCallback(callback)** *- Defines a callback function for handling the result of a completed worker execution.*  
 @param {executeCallback} callback - Executes after the main thread receives a "complete" message  

**main.addWorker()** *- Adds an extra worker thread for the Batch Processor*  
 @returns {Number} The threadId of the new worker  

**main.removeWorker(threadId, immediate)** *- Removes a worker thread from the Batch Processor.*  
 @param {String | undefined} [threadId] Optionally remove a specific worker thread id  
 @param {Boolean | undefined} [immediate] Optionally remove the worker before it finishes the current iteration  
 @returns {Boolean} If a worker was selected to be removed (The worker has not yet been removed)  

**startWorking(iterable, callback)** *- Completes setup of the main thread and begins sending tasks to the worker threads.*  
 This method needs to be called if autoStart is not configured to be true  
 Can be used to resume processing after main.stopWorking has been called  
 @param {Iterable} [iterable] (main.setIterable) The list of items to be processed by workers  
 @param {executeCallback} [callback] (main.setCallback) Function for handling the result of a completed worker execute  

**stopWorking(immediate)** *- Stops processing of additional tasks, but in a resumable state which can be continued with main.startWorking()*  
 @param {Boolean} [immediate] Stop workers without waiting for completion of their current task(s)  

 **main.stats.log()** *- Generates a simple display of all available statistics.*  
 See src/statsTracker for a full list individual of stats available through main.stats  
 ```
 =========== Batch Processor Stats ===========
   Started: 3:52:03 AM
   Estimated End: 3:52:49 AM (0.01 hrs)
   Processed: 7 / 21 (2519.50 p/hr)
   Success: 5 (1799.64 p/hr)
   Failures: 2 (719.86 p/hr)
   Errors: 1 (359.93 p/hr)
 =============================================
 ```

 **main.stats.autoLog(seconds)** *- Automatically logs stats to the console at the specified interval.*
  @param {Number} seconds - The number of seconds to wait between each log 

 ### Worker thread  
Note: These endpoints are only accessible within prepareWorkerThread and execute.

**worker.recordSuccess(iterated, details)** *- Sends a success message to the main thread.*  
 Used for statistics and logging execution results  
 @param {*} iterated - The iteratedObject for this execution  
 @param {String} [details] - Any noteworthy details of the success   

**worker.recordFailure(iterated, details)** - *- Sends a failed message to the main thread.*  
 Used for statistics and logging execution results  
 @param {*} iterated - The iteratedObject for this execution   
 @param {String} [details] - Any noteworthy details of the failure  

**worker.recordError(iterated, error)** *- Sends an error message to the main thread.*  
 Used for statistics and logging execution results  
 @param {*} iterated - The iteratedObject for this execution  
 @param {Error | String} error - The error encountered during execution  
