
module.exports = class StatsTracker {


    /**
     * Container for keeping track of the Batch Processor statistics
     */
    constructor() {
        this.startTime = new Date();
        this.runTime = new Date();
        this.completionTime = new Date();
        this.completionHours = 0;
        this.totalTasks = 0;
        this.processedTasks = 0;
        this.hProcessedTasks = 0;
        this.remainingTasks = 0;
        this.successful = 0;
        this.hSuccessful = 0;
        this.failed = 0;
        this.hFailed = 0;
        this.errors = 0;
        this.hErrors = 0;
    }


    /**
     * Updates all of the time based statistics
     */
    updateCalculatedFields() {
        if (this.totalTasks == 0) return;
        const now = new Date();
        this.runTime = now - this.startTime;
        this.remainingTasks = this.totalTasks - this.processedTasks;
        this.hProcessedTasks = hourly(this.processedTasks, this.runTime);
        this.hSuccessful = hourly(this.successful, this.runTime);
        this.hFailed = hourly(this.failed, this.runTime);
        this.hErrors = hourly(this.errors, this.runTime);
        this.completionHours = (this.remainingTasks / this.hProcessedTasks).toFixed(2);
        this.completionTime = new Date(now.getTime() + (this.completionHours * 60 * 60 * 1000));
    }


    /**
     * Generates a simple display of all of the statistics
     */
    log() {
        this.updateCalculatedFields();
        const header = ' =========== Batch Processor Stats ===========';
        const start = `  Started: ${this.startTime.toLocaleTimeString()}`;
        const end = `  Estimated End: ${this.completionTime.toLocaleTimeString()} (${this.completionHours} hrs)`
        const processed = `  Processed: ${this.processedTasks} / ${this.totalTasks} (${this.hProcessedTasks} p/hr)`;
        const success = `  Success: ${this.successful} (${this.hSuccessful} p/hr)`;
        const failed = `  Failures: ${this.failed} (${this.hFailed} p/hr)`;
        const errors = `  Errors: ${this.errors} (${this.hErrors} p/hr)`;
        const footer = '=============================================';
        console.log(header +'\n', start +'\n', end +'\n', processed +'\n', success +'\n', failed +'\n', errors +'\n', footer +'\n');
    }


    /**
     * Automatically logs stats to the console at the specified interval
     * @param {Number} seconds - The number of seconds to wait between each log 
     */
    autoLog(seconds) {
        const stats = this;
        this.logInterval = setInterval(function() {
            if (stats.totalTasks > 0) {
                stats.log();
            }
        }, seconds * 1000);
    }

}


/**
 * Calculates the amount of events which will happen per hour
 * @param {Number} stat - The number of events that have taken place
 * @param {Number} runtime - The milliseconds since the events have started
 * @returns 
 */
function hourly(stat, runtime) {
    const hour = 1000 * 60 * 60; 
    return ((stat * hour) / runtime).toFixed(2);
}