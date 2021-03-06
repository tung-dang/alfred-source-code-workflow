var fs = require('fs');
var path = require('path');

var _ = require('underscore');

var AlfredNode = require('alfred-workflow-nodejs');
var Item = AlfredNode.Item;
var actionHandler = AlfredNode.actionHandler;
var workflow = AlfredNode.workflow;
workflow.setName('alfred-source-code-wf');
var Item = AlfredNode.Item;
var utils = AlfredNode.utils;
var storage = AlfredNode.storage;
var ICONS = AlfredNode.ICONS;

var git = require('./git-info.js');

var actions = require('./actions.js');
var OpenConfigFileAction = actions.OpenConfigFileAction;

(function main() {
    // load projects list
    actionHandler.onAction('loadProjects', function(query) {
        query = query ? query.trim() : '';
        loadProjects(query);
    });

    // load project's actions
    actionHandler.onMenuItemSelected('loadProjects', function(query, selectedTitle, selectedData) {
        query = query ? query.trim() : '';
        loadProjectActions(query, selectedTitle, selectedData);
    });

    // execute project action
    actionHandler.onAction('execute', function(arg) {
        executeProjectAction(arg);
    });

    // open config file
    actionHandler.onAction('config', function(query) {
        OpenConfigFileAction.execute();
    });

    AlfredNode.run();
})();

function loadProjects(query) {
    query = query ? query.toLowerCase() : '';
    var projects = [];

    // read config file for source path
    fs.readFile('./config.json', 'utf8', function(err, data) {
        if (err && err.code == 'ENOENT') {
            console.log('Error: config file not found');
            return;
        }

        var config = JSON.parse(data);

        var sourceFolders = config['source-containers'];

        var hasProjectPathConfig = false;
        if (sourceFolders && sourceFolders.length > 0) {
            hasProjectPathConfig = true;
            _.each(sourceFolders, function(path) {
                var folders = _getDirectories(path);

                _.each(folders, function(folder) {
                    projects.push({
                        name: folder,
                        path: path + '/' + folder
                    });
                });
            });
        }

        var sources = config['sources'];
        if (sources && !_.isEmpty(sources)) {
            hasProjectPathConfig = true;
            _.each(sources, function(path, name) {
                projects.push({
                    name: name,
                    path: path
                });

            });
        }

        if (!hasProjectPathConfig) {
            var item = new Item({
                title: 'No project path configured. Enter to open config file.',
                icon: ICONS.INFO,
                valid: true,
                arg: JSON.stringify({
                    action: OpenConfigFileAction.actionName
                })
            });

            workflow.addItem(item);
            workflow.feedback();

            return;
        }

        var filteredProjects = utils.filter(query, projects, function(item) {
            return item.name.toLowerCase() + " " + item.name.toLowerCase().replace(/\-/g, ' ');
        });

        var noOfProjects = filteredProjects.length;

        var stashServer = config['stash-server'];
        _.each(filteredProjects, function(project) {
            var name = project.name;
            var path = project.path;

            _detectProjectInfo(path, stashServer, function(info) {
                var projectType = info.projectType;
                var item = new Item({
                    uid: path,
                    title: name,
                    subtitle: path,
                    icon: projectType ? 'icons/' + projectType + '.png' : '',
                    hasSubItems: true,
                    valid: false,
                    data: {
                        name: name,
                        path: path,
                        projectType: projectType,
                        gitInfo: info.gitInfo
                    }
                });

                workflow.addItem(item);

                noOfProjects--;

                if (noOfProjects === 0) {
                    // generate feedbacks
                    workflow.feedback();
                }
            });
        });
    });
}

function loadProjectActions(query, selectedTitle, selectedData) {
    var projectActions = actions['projectActions'];

    var events = require('events');
    var eventEmitter = new events.EventEmitter();

    query = query ? query.toLowerCase() : '';

    var filteredActions = utils.filter(query, projectActions, function(action) {
        return action.filterKey().toLowerCase();
    });

    var noOfActions = filteredActions.length;

    if (noOfActions === 0) {
        workflow.feedback();
        return;
    }

    var items = [];

    _.each(filteredActions, function(action) {
        action.build(selectedData, function(item) {
            noOfActions--;

            if (item) {
                items.push(item);
            }
            // if all actions are built
            // generate feedback
            if (noOfActions === 0) {
                _.each(items, function(item) {
                    workflow.addItem(item);
                });

                workflow.feedback();
            }
        });
    });
}

function executeProjectAction(arg) {
    var data = JSON.parse(arg);
    // handle "OpenConfigFileAction"
    if (data.action === OpenConfigFileAction.actionName) {
        OpenConfigFileAction.execute(arg);
        return;
    }

    // Handle project actions
    var projectActions = actions.projectActions;
    _.each(projectActions, function(action) {
        action.execute(arg);
    });
}

// return all sub folder in path
function _getDirectories(folderPath) {
    return fs.readdirSync(folderPath).filter(function(file) {
        return fs.statSync(path.join(folderPath, file)).isDirectory();
    });
}

function _detectProjectInfo(path, stashServer, callback) {
    // get from cache
    var projectsInfo = storage.get('projectsInfo');
    if (projectsInfo && projectsInfo[path]) {
        callback(projectsInfo[path]);
    } else {
        var info = {};
        _detectProjectType(path, function(projectType) {
            info.projectType = projectType;

            _detectGitInfo(path, stashServer, function(gitInfo) {
                info.gitInfo = gitInfo;
                if (!projectsInfo) {
                    projectsInfo = {};
                }
                projectsInfo[path] = info;
                storage.set('projectsInfo', projectsInfo);
                callback(info);
            })
        });
    }
}

function _detectProjectType(path, callback) {
    _isFileExists(path + '/pom.xml', function() {
        callback('java');
    }, function() {
        _isFileExists(path + '/package.json', function() {
            callback('nodejs');
        }, function() {
            callback(undefined);
        });
    });
}

var _detectGitInfo = function(path, stashServer, callback) {
    git.gitInfo(path, function(error, info) {
        callback(info);
    }, stashServer);
}

function _isFileExists(file, existsCallback, notFoundCallback) {
    fs.readFile(file, 'utf8', function(err, data) {
        if (err && err.code == 'ENOENT') {
            notFoundCallback();
        } else {
            existsCallback();
        }
    });
}