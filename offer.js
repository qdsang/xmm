exports.command = "offer <offer>";
exports.desc = "Create a limit order";
exports.aliases = [
	"create",
	"order"
];
exports.builder = yargs => yargs;
exports.handler = connect((config, xmm) => {
	console.info(xmm.ledger);
	process.exit();
});
