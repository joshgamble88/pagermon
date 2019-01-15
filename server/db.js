var fs = require('fs');
var logger = require('./log');
var nconf = require('nconf');
var conf_file = './config/config.json';
nconf.file({file: conf_file});
nconf.load();

// initialize the database if it does not already exist
function init(release) {
    var dbtype = nconf.get('database:type')
    var dbfile = nconf.get('database:file')
    var dbserver = nconf.get('database:server')
    var dbdb = nconf.get('database:database')
    var dbusername = nconf.get('database:username')
    var dbpassword = nconf.get('database:password')

    //This is here for compatibility with old versions. 
    if (dbtype == null || dbtype == 'sqlite') {
        nconf.set('database:type', 'sqlite3');
        nconf.set('database:file', './messages.db');
        nconf.save()
    }

    var db = require('knex')({
        client: dbtype,
        connection: {
            filename: dbfile,
            host: dbserver,
            user: dbusername,
            password: dbpassword,
            database: dbdb
        },
        useNullAsDefault: true,
        debug: true,
    })



    db.schema.hasTable('capcodes').then(function (exists) {
        if (!exists) {
            return db.schema.createTable('capcodes', table => {
                table.increments('id').primary().notNullable();
                table.string('address', [255]).notNullable();
                table.text('alias').notNullable();
                table.text('agency');
                table.text('icon');
                table.text('color');
                table.text('pluginconf')
                table.integer('ignore').defaultTo(0);
                table.unique(['id', 'address'], 'cc_pk_idx');
            });
        } else {
            // update the schema instead
            return 'blah';
        }
    }).then(function (result) {
        // figure out if the return is from a creation or update
        console.log('Created/updated Table ', result);
        return db.schema.hasTable('messages');
    }).then(function (exists) {
        if (!exists) {
            return db.schema.createTable('messages', table => {
                table.increments('id').primary().unique();
                table.string('address', [255]).notNullable();
                table.text('message').notNullable();
                table.text('source').notNullable();
                table.integer('timestamp');
                table.integer('alias_id').unsigned()
                table.foreign('alias_id').references('capcodes.id');
                table.index(['address', 'id'], 'msg_index');
                table.index(['id', 'alias_id'], 'msg_alias');
                table.index(['timestamp', 'alias_id'], 'msg_timestamp');
            });
        } else {
            // update the schema instead
            return 'blah';
        }
    }).then(function (result) {
        // figure out if the return is from a creation or update
        console.log('Created/updated Table ', result)
        if (dbtype == 'sqlite3') {
            db.raw('CREATE VIRTUAL TABLE IF NOT EXISTS messages_search_index USING fts3(message, alias, agency);')
                .then((result) => {

                })
                .catch((err) => {

                })
            db.raw(`
                    CREATE TRIGGER IF NOT EXISTS messages_search_index_insert AFTER INSERT ON messages BEGIN
                    INSERT INTO messages_search_index(
                            rowid,
                            message,
                            alias,
                            agency
                        )
                                VALUES(
                            new.id,
                            new.message,
                            (SELECT alias FROM capcodes WHERE id = new.alias_id),
                        (SELECT agency FROM capcodes WHERE id = new.alias_id)
                                );
                    END;
                    `)
                .then((result) => {

                })
                .catch((err) => {

                })
            db.raw(`
                    CREATE TRIGGER IF NOT EXISTS messages_search_index_update AFTER UPDATE ON messages BEGIN
                                UPDATE messages_search_index SET
                                    message = new.message,
                                    alias = (SELECT alias FROM capcodes WHERE id = new.alias_id),
                                    agency = (SELECT agency FROM capcodes WHERE id = new.alias_id)
                                WHERE rowid = old.id;
                                END;
                    `)
                .then((result) => {

                })
                .catch((err) => {

                })
            db.raw(`
                    CREATE TRIGGER IF NOT EXISTS messages_search_index_delete AFTER DELETE ON messages BEGIN
                                DELETE FROM messages_search_index WHERE rowid = old.id;
                                END;
                    `)
                .then((result) => {

                })
                .catch((err) => {

                })
            db.raw(`
                    INSERT INTO messages_search_index (rowid, message, alias, agency)
                                SELECT messages.id, messages.message, capcodes.alias, capcodes.agency 
                                FROM messages LEFT JOIN capcodes ON capcodes.id = messages.alias_id
                                WHERE messages.id NOT IN (SELECT rowid FROM messages_search_index);
                    `)
                .then((result) => {
                
                })
                .catch((err) => {

                })
            db.raw(`pragma user_version;`).then(function (res) {
                console.log("Current DB version: " + res[0].user_version);
                console.log("Latest DB version: " + release);
                if (res[0].user_version < release && res[0].user_version != 0) {
                    console.log("DB schema out of date, updating");
                    db.schema.table('capcodes', table => {
                        table.integer('push');
                        table.text('pushpri');
                        table.text('pushgroup');
                        table.text('pushsound');
                        table.integer('mailenable');
                        table.text('mailto');
                        table.integer('telegram');
                        table.text('telechat');
                        table.integer('ignore');
                        table.integer('twitter');
                        table.text('twitterhashtag');
                        table.integer('discord');
                        table.text('discwebhook');
                        table.text('pluginconf');
                    });
                    db.schema.table('messages', table => {
                        table.index(['timestamp', 'alias_id'], 'msg_timestamp');
                    });
                    
                }
                if (res[0].user_version < '20181118' && res[0].user_version != 0) {
                    // begin scary stuff, consider hiding behind a solid object during this bit - not converting this to knex because it should only be a once off thing
                    db.raw(`
                    PRAGMA foreign_keys=off;
                    BEGIN TRANSACTION;
                    ALTER TABLE capcodes RENAME TO _capcodes_backup;
                    DROP INDEX IF EXISTS cc_pk_idx;
                    UPDATE _capcodes_backup SET pluginconf = '{}';
                    UPDATE _capcodes_backup SET pluginconf = '{
                        "Discord": {
                            "enable": ' || REPLACE(REPLACE(COALESCE(discord,0),0,'false'),1,'true') || ',
                            "webhook": "' || COALESCE(discwebhook,'') || '"
                        },
                        "Pushover": {
                            "enable": ' || REPLACE(REPLACE(COALESCE(push,0),0,'false'),1,'true') || ',
                            "priority": {"value": "' || COALESCE(pushpri,'') || '"},
                            "group": "' || COALESCE(pushgroup,'') || '",
                            "sound": {"value": "' || COALESCE(pushsound,'') || '"}
                        },
                        "SMTP": {
                            "enable": ' || REPLACE(REPLACE(COALESCE(mailenable,0),0,'false'),1,'true') || ',
                            "mailto": "' || COALESCE(mailto,'') || '"
                        },
                        "Telegram": {
                            "enable": ' || REPLACE(REPLACE(COALESCE(telegram,0),0,'false'),1,'true') || ',
                            "chat": "' || COALESCE(telechat,'') || '"
                        },
                        "Twitter": {
                            "enable": ' || REPLACE(REPLACE(COALESCE(twitter,0),0,'false'),1,'true') || ',
                            "hashtag": "' || COALESCE(twitterhashtag,'') || '"
                        }
                    }';

                    CREATE TABLE IF NOT EXISTS "capcodes" (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    address TEXT NOT NULL,
                    alias TEXT NOT NULL,
                    agency TEXT,
                    icon TEXT,
                    color TEXT,
                    ignore INTEGER DEFAULT 0,
                    pluginconf TEXT);

                    INSERT INTO capcodes (id, address, alias, agency, icon, color, ignore, pluginconf)
                        SELECT id, address, alias, agency, icon, color, ignore, pluginconf
                        FROM _capcodes_backup;

                    COMMIT;
                    PRAGMA foreign_keys=on;
                    CREATE UNIQUE INDEX IF NOT EXISTS cc_pk_idx ON capcodes (id,address DESC);
                    `).catch(function (err) {
                        console.error('Failed to convert database ... aborting ' + err)
                    });
                    var vervar = 'pragma user_version = ' + release + ';'
                    db.raw(vervar)
                        .catch(function (err) {
                            console.log(err)
                        });
                    console.log("DB schema update complete");
                    // Switch config file over to plugin format
                    console.log("Updating config file");
                    var nconf = require('nconf');
                    var conf_file = './config/config.json';
                    var conf_backup = './config/backup.json';
                    nconf.file({ file: conf_file });
                    nconf.load();
                    var curConfig = nconf.get();
                    fs.writeFileSync(conf_backup, JSON.stringify(curConfig, null, 2));
                    if (!curConfig.plugins)
                        curConfig.plugins = {};

                    if (curConfig.discord) {
                        curConfig.plugins.Discord = {
                            "enable": curConfig.discord.discenable
                        };
                    }
                    if (curConfig.pushover) {
                        curConfig.plugins.Pushover = {
                            "enable": curConfig.pushover.pushenable,
                            "pushAPIKEY": curConfig.pushover.pushAPIKEY
                        };
                    }
                    if (curConfig.STMP) {
                        curConfig.plugins.SMTP = {
                            "enable": curConfig.STMP.MailEnable,
                            "mailFrom": curConfig.STMP.MailFrom,
                            "mailFromName": curConfig.STMP.MailFromName,
                            "server": curConfig.STMP.SMTPServer,
                            "port": curConfig.STMP.SMTPPort,
                            "username": curConfig.STMP.STMPUsername,
                            "password": curConfig.STMP.STMPPassword,
                            "secure": curConfig.STMP.STMPSecure
                        };
                    }
                    if (curConfig.telegram) {
                        curConfig.plugins.Telegram = {
                            "enable": curConfig.telegram.teleenable,
                            "teleAPIKEY": curConfig.telegram.teleAPIKEY
                        };
                    }
                    if (curConfig.twitter) {
                        curConfig.plugins.Twitter = {
                            "enable": curConfig.twitter.twitenable,
                            "consKey": curConfig.twitter.twitconskey,
                            "consSecret": curConfig.twitter.twitconssecret,
                            "accToken": curConfig.twitter.twitacctoken,
                            "accSecret": curConfig.twitter.twitaccsecret,
                            "globalHashtags": curConfig.twitter.twitglobalhashtags
                        };
                    }
                    delete curConfig.discord;
                    delete curConfig.pushover;
                    delete curConfig.STMP;
                    delete curConfig.telegram;
                    delete curConfig.twitter;
                    fs.writeFileSync(conf_file, JSON.stringify(curConfig, null, 2));
                    nconf.load();
                    console.log("Config file updated!");

                } else {
                    console.log("DB schema up to date!");
                }
            }).catch(function (err) {
                console.log('Error getting DB Version')
            });
        
        }
        if (dbtype == 'mysql') {
            db.raw(`
                    CREATE TRIGGER capcodes_insert_id 
                    BEFORE INSERT 
                    ON capcodes 
                    FOR EACH ROW BEGIN
                        SET NEW.id = (SELECT MAX(id) + 1 FROM capcodes);
                        IF ( NEW.id IS NULL ) THEN SET NEW.id = 1;
                        END IF;
                    END;
                    `)
                .then((result) => {
                    console.log(result[0])
                })
                .catch((err) => {
                    console.log(err)
                })
            db.raw(`
                    ALTER TABLE messages ADD FULLTEXT (message, source, alias_id, address);
                    `)
                .then((result) => {
                    console.log(result[0])
                })
                .catch((err) => {
                    console.log(err)
                })
            db.raw(`
                    ALTER TABLE capcodes ADD FULLTEXT (alias, agency);
                    `)
                .then((result) => {
                    console.log(result[0])
                })
                .catch((err) => {
                    console.log(err)
                })
        }
    }).then(function (result) {
        // figure out if the return is from a creation or update
        console.log('Schema update complete ', result);
        if (dbtype == 'sqlite3') {
            var vervar = 'pragma user_version = ' + release + ';'
            db.raw(vervar)
        }
    }).catch(function (err) {
        console.error(err);
    });
}

module.exports = {
    init: init
}
