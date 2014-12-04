var chalk = require('chalk');

console.log(chalk.magenta('Tock every 5 seconds.'));
setInterval(function(){
  console.log(chalk.bold.red.underline('Tock'), Date.now());
}, 1000 - Date.now() % 1000);