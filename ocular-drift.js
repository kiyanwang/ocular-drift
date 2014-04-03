var program  = require("commander");
var async    = require("async");
var imageapi = require("resemble");
var sys      = require('sys');
var exec     = require('child_process').exec;
var fs       = require('fs');

program
    .version('0.0.1')
    .option('-b, --build <build>', 'browser stack build id')
    .option('-s, --session <session>', 'browser stack session id')
    .option('-o, --output <output>', 'output dir')
    .parse(process.argv);

program.on('--help', function(){
    console.log('  Credentials:');
    console.log('    To supply crendentials for Browser stack you must export two environment variables');
    console.log('      $ export BROWSERSTACK_TOKEN=<your token>');
    console.log('      $ export BROWSERSTACK_USER=<your user>');
    console.log('');
});

if(!program.build || !program.session || !process.env.BROWSERSTACK_TOKEN || !process.env.BROWSERSTACK_USER){
    console.error("\nERROR: You must specify browser stack build id, and session id");
    program.help();
}

var CONFIG = {
    BUILD_ID: program.build,
    SESSION_ID: program.session,
    BROWSERSTACK_TOKEN: process.env.BROWSERSTACK_TOKEN,
    BROWSERSTACK_USER: process.env.BROWSERSTACK_USER,
    OUTPUT_DIR: "./output",
    BASELINE_DIR: "./baseline",
    TOLERANCE: 0.5
};

if(program.output){
    CONFIG.OUTPUT_DIR = program.output;
}
console.log(CONFIG);

var screenshots = [];
var comparisons = [];

function getRows(){
    var rows = "";
    comparisons.forEach(function(comparison){
        if(comparison.results.misMatchPercentage > CONFIG.TOLERANCE){
            rows += "" +
                "<tr>" +
                "   <td>"+comparison.filename+"</td>" +
                "   <td>"+comparison.results.misMatchPercentage+"</td>" +
                "   <td><img src='"+comparison.baseLine+"' height='200' width='200'/></td>" +
                "   <td><img src='"+comparison.checkFile+"' height='200' width='200'/></td>";

            if(comparison.diffFile){
                rows += "   <td><img src='"+comparison.diffFile+"' height='200' width='200'/></td>";
            } else {
                rows += "   <td> n/a </td>";
            }

            rows += "</tr>";
        }
    });

    return rows;
}

async.series([
    function(cb){

        var cmd = 'curl -u "'+ CONFIG.BROWSERSTACK_USER+':'+CONFIG.BROWSERSTACK_TOKEN+'" https://www.browserstack.com/automate/builds/'+CONFIG.BUILD_ID+'/sessions/'+CONFIG.SESSION_ID+'/logs | grep DEBUG | awk \'{ print $4 }\'';
        exec(cmd, function(err, stdout, stderr){
            if(err){
                cb(err);
            } else {
                screenshots = stdout.split("\r\n");
                screenshots.pop();
                cb(null, "retrieved logs, and extracted screenshot uris");
            }
        });
    },
    function(cb){
        var numShots = screenshots.length;
        screenshots.forEach(function(screenshoturl){
            var bits = screenshoturl.split("/");
            var filename = CONFIG.OUTPUT_DIR + "/" + bits[bits.length-1];

            var cmd = 'wget -O ' + filename + ' ' + screenshoturl + ' && convert ' + filename + ' ' + filename + '.png && rm -f ' + filename;
            console.log(cmd);
            exec( cmd, function(err, stdout, stderr){
                if(err){
                    cb(err);
                } else {
                    if(!--numShots){
                        cb(null, "done downloading screenshots");
                    }
                }
            });
        });
    },
    function(cb){
        var numShots = screenshots.length;
        screenshots.forEach(function(screenshoturl){
            var bits = screenshoturl.split("/");
            var checkFile = CONFIG.OUTPUT_DIR + "/" + bits[bits.length-1] + '.png';
            var filename =  bits[bits.length-1] + '.png';
            var baselineFile = CONFIG.BASELINE_DIR + "/" + bits[bits.length-1] + '.png';

            var checkFileData = fs.readFileSync( checkFile );
            var baselineFileData  = fs.readFileSync( baselineFile );

            imageapi.resemble(checkFileData).compareTo(baselineFileData).onComplete(function(data){
                console.log("Compared " + checkFile + " with " + baselineFile + " results: " + JSON.stringify(data));
                var result = {
                    filename: filename,
                    checkFile: checkFile,
                    baseLine: baselineFile,
                    results: {
                        isSameDimensions: data.isSameDimensions,
                        misMatchPercentage: parseFloat(data.misMatchPercentage),
                        analysisTime: data.analysisTime
                    }
                };

                if(parseFloat(data.misMatchPercentage) > CONFIG.TOLERANCE){
                    var base64DataRaw = data.getImageDataUrl();
                    var base64Data = base64DataRaw.replace(/^data:image\/png;base64,/,"");
                    fs.writeFileSync(CONFIG.OUTPUT_DIR+"/diff/"+filename, base64Data , "base64");
                    result.diffFile = CONFIG.OUTPUT_DIR+"/diff/"+filename;
                }

                comparisons.push(result);

                if(!--numShots){
                    cb(null, "done comparisons");
                }
            });
        });
    },
    function(cb){
        // generate report
        var htmlString = "" +
            "<!doctype html>" +
            "<html>" +
            "   <head><title>Ocular Drift Report</title></head>" +
            "   <style>" +
            "   table, th, td {" +
            "       border: 1px solid red;" +
            "       vertical-align: top;" +
            "       text-align: center;" +
            "   }" +
            "   </style>" +
            "   <body>" +
            "       <table>" +
            "           <tr>" +
            "               <th>file</th>" +
            "               <th>mismatch %</th>" +
            "               <th>baseline</th>" +
            "               <th>candidate</th>" +
            "               <th>diff</th>" +
            "           </tr>" +
                        getRows() +
            "       </table>" +
            "   </body>" +
            "</html>";

        fs.writeFileSync("./report.html", htmlString, "UTF-8");
        cb(null, "generated report");
    }
], function(err,results){
    if(err){
        console.error(err);
        process.exit(1);
    } else {
        console.log(results);
        process.exit(0)
    }
});



