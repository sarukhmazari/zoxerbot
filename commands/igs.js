const instagramCommand = require('./instagram');

// Export both names to guarantee compatibility with any import style
module.exports = {
    igsCommand: instagramCommand,
    igdCommand: instagramCommand
};
