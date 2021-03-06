import { writeFile, readFile } from "fs"
import * as prometheus from "prom-client";

type LogMap = {
    [key:string]:number[];
}

type promHistMap = {
    [key:string]:prometheus.Histogram<string>;
}

type promSumMap = {
    [key:string]:prometheus.Summary<string>;
}

type TimeTracker = {
    [key:string]:number;
}

type TimeTrackerLog = {
    [key:string]:TimeTracker[];
}

export class TimerLogsMap
{
    logs:LogMap;
    prom_logs:promHistMap;

    constructor()
    {
        this.logs = {};
        this.prom_logs = {};
        /* readFile("src/Monitoring/logs/timers.json", "utf8", (err, data) => 
        {
            if(err) return err;
            this.logs = JSON.parse(data);
        }); */
    }

    public addTimeLog(key:string, time:number):void
    {
        if(this.logs[key] === undefined || this.prom_logs[key] === undefined)
        {
            this.logs[key] = [];
            this.prom_logs[key] = new prometheus.Histogram({
                name: "custom_histogram_" + key,
                help: "a custom timer histogram related to " + key,
                buckets: [2,5,10,25,50,75,150,300,500,1000,5000,10000]
            });
        }
        this.logs[key].push(time);
        this.prom_logs[key].observe(time);
        //writeFile("src/Monitoring/logs/timer.json", JSON.stringify(this.logs), "utf8", ()=>{});
    }
}

export class Timer
{
    key:string;
    start:number;
    static logMap:TimerLogsMap;

    constructor(key:string)
    {
        this.key = key;
        this.start = new Date().getTime();
    }

    public stop():number
    {
        let delta:number = new Date().getTime() - this.start;
        Timer.logMap.addTimeLog(this.key, delta);
        return delta;
    }
}

export class RequestTrackerLog
{   
    logs:TimeTrackerLog;
    prom_logs_sum:promSumMap;
    prom_logs_hist:promHistMap;

    constructor()
    {
        this.logs = {};
        this.prom_logs_sum = {};
        this.prom_logs_hist={};
        /* readFile("src/Monitoring/logs/request_tracker.json", "utf8", (err, data) => 
        {
            if(err) return err;
            this.logs = JSON.parse(data);
        }); */
    }

    public addTracker(tracker:RequestTracker):void
    {
        let label:string = tracker.label;
        if(this.logs[label] === undefined)
        {
            this.logs[label] = [];
        }
        Object.entries(tracker.logs).forEach(([key, value]) => 
        {
            console.log(key, value);
            if(this.prom_logs_sum[key] === undefined)
            {
                this.prom_logs_sum[key] = new prometheus.Summary({
                    name: "custom_summary_tracker_" + key,
                    help: "a custom summary to record the time of " +  key,
                    labelNames: ["operation_description"],
                })
            }
            this.prom_logs_sum[key].observe({operation_description: label}, value);
            if(this.prom_logs_hist[key] === undefined)
            {
                this.prom_logs_hist[key] = new prometheus.Histogram({
                    name: "custom_histogram_tracker_" + key,
                    help: "a custom summary to record the time of " +  key,
                    labelNames: ["operation_description"],
                    buckets: [2,5,10,25,50,75,150,300,500,1000,5000,10000]
                })
            }
            this.prom_logs_hist[key].observe({operation_description: label}, value);
        })
        this.logs[label].push(tracker.logs);
        //writeFile("src/Monitoring/logs/request_tracker.json", JSON.stringify(this.logs), "utf8", ()=>{});
    }
}

export class RequestTracker
{
    logs:TimeTracker;
    label:string;
    last:number;
    static logMap:RequestTrackerLog;

    constructor( label:string)
    {
        this.logs = {};
        this.last = new Date().getTime();
        this.label = label;
    }

    public endStep(step:string):void
    {
        let tmp = new Date().getTime();
        this.logs[step] = tmp - this.last + (this.logs[step] === undefined ? 0 : this.logs[step]);
        this.last = tmp;
    }

    public log():void
    {
        RequestTracker.logMap.addTracker(this);
    }

    public updateLabel(label:string):void
    {
        this.label += "_" + label;
    }
}