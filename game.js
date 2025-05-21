
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 480,
    physics: {
        default: 'arcade',
        arcade: { gravity: { y: 800 }, debug: false }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

let player, cursors;

const game = new Phaser.Game(config);

function preload() {
    this.load.image('player', 'assets/theo.png');
    this.load.image('ground', 'assets/ground.png');
    this.load.audio('music', 'audio/punk8bit.mp3');
}

function create() {
    this.sound.add('music', { loop: true }).play();
    const ground = this.physics.add.staticGroup();
    ground.create(400, 460, 'ground').setScale(2).refreshBody();
    player = this.physics.add.sprite(100, 300, 'player');
    player.setBounce(0.2);
    player.setCollideWorldBounds(true);
    this.physics.add.collider(player, ground);
    cursors = this.input.keyboard.createCursorKeys();
}

function update() {
    if (cursors.left.isDown) {
        player.setVelocityX(-160);
    } else if (cursors.right.isDown) {
        player.setVelocityX(160);
    } else {
        player.setVelocityX(0);
    }
    if (cursors.up.isDown && player.body.touching.down) {
        player.setVelocityY(-400);
    }
}
