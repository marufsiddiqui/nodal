"use strict";

module.exports = (function() {

  const Adapter = require('./adapter.js');
  const fs = require('fs');
  const inflect = require('i')();

  class SchemaGenerator {

    constructor(db) {

      this.db = db;

      this.migrationId = null;
      this.models = {};
      this.indices = [];

      this._defaultPath = 'db/schema.json';

    }

    load(filename) {
      filename = filename || this._defaultPath;
      filename = process.cwd() + '/' + filename;
      return this.set(JSON.parse(fs.readFileSync(filename)));
    }

    save(filename) {
      filename = filename || this._defaultPath;
      filename = process.cwd() + '/' + filename;
      fs.writeFileSync(filename, this.generate());
      return true;
    }

    mergeProperties(columnData, properties) {

      properties = properties || {};

      let defaults = this.db.adapter.typePropertyDefaults;

      let oldProperties = this.db.adapter.getTypeProperties(columnData.type, columnData.properties) || {};
      let newProperties = {};

      this.db.adapter.typeProperties.forEach(function(v) {
        if (properties.hasOwnProperty(v) && properties[v] !== defaults[v]) {
          newProperties[v] = properties[v];
        } else if (oldProperties.hasOwnProperty(v) && oldProperties[v] !== defaults[v]) {
          newProperties[v] = oldProperties[v];
        }
      });

      if (Object.keys(newProperties).length) {
        columnData.properties = newProperties;
      } else {
        delete columnData.properties;
      }

      return columnData;

    }

    set(schema) {

      this.setMigrationId(schema.migration_id);
      this.models = schema.models || {};
      this.indices = schema.indices || [];

      return true;

    }

    setMigrationId(id) {
      this.migrationId = id;
    }

    createTable(table, arrColumnData) {

      let tableClass = inflect.classify(table);

      arrColumnData = arrColumnData.slice();

      let columns = arrColumnData.map(function(v) {
        return v.name;
      });

      if (columns.indexOf('id') === -1) {
        arrColumnData.unshift({name: 'id', type: 'serial'});
      }

      if (columns.indexOf('created_at') === -1) {
        arrColumnData.push({name:'created_at', type: 'datetime'});
      }

      let defaults = this.db.adapter.typePropertyDefaults;

      arrColumnData.forEach((function(columnData) {
        this.mergeProperties(columnData);
      }).bind(this));

      this.models[tableClass] = {
        table: table,
        columns: arrColumnData
      };

      return arrColumnData;

    }

    dropTable(table, columnData) {

      let tableClass = inflect.classify(table);

      delete this.models[tableClass];

      return true;

    }

    alterColumn(table, column, type, properties) {

      if (properties.primary_key) {
        delete properties.unique;
      }

      let models = this.models;
      let modelKey = Object.keys(models).filter(function(t) {
        return models[t].table === table;
      }).pop();

      if (!modelKey) {
        throw new Error('Table "' + table + '" does not exist');
      }

      let schemaFieldData = models[modelKey].columns.filter(function(v) {
        return v.name === column;
      }).pop();

      if (!schemaFieldData) {
        throw new Error('Column "' + column + '" of table "' + table + '" does not exist');
      }

      schemaFieldData.type = type;

      this.mergeProperties(schemaFieldData, properties);

      return true;

    }

    addColumn(table, column, type, properties) {

      if (properties.primary_key) {
        delete properties.unique;
      }

      let models = this.models;
      let modelKey = Object.keys(models).filter(function(t) {
        return models[t].table === table;
      }).pop();

      if (!modelKey) {
        throw new Error('Table "' + table + '" does not exist');
      }

      let modelSchema = models[modelKey];

      let schemaFieldData = modelSchema.columns.filter(function(v) {
        return v.name === column;
      }).pop();

      if (schemaFieldData) {
        throw new Error('Column "' + column + '" of table "' + table + '" already exists');
      }

      let columnData = {
        name: column,
        type: type,
        properties: properties
      };

      modelSchema.columns.push(columnData);

      return true;

    }

    dropColumn(table, column) {

      let models = this.models;
      let modelKey = Object.keys(models).filter(function(t) {
        return models[t].table === table;
      }).pop();

      if (!modelKey) {
        throw new Error('Table "' + table + '" does not exist');
      }

      let modelSchema = models[modelKey];

      let columnIndex = modelSchema.columns.map(function(v, i) { return v.name; }).indexOf(column);

      if (columnIndex === -1) {
        throw new Error('Column "' + column + '" of table "' + table + '" does not exist');
      }

      modelSchema.columns.splice(columnIndex, 1);

      return true;

    }

    renameColumn(table, column, newColumn) {

      let models = this.models;
      let modelKey = Object.keys(models).filter(function(t) {
        return models[t].table === table;
      }).pop();

      if (!modelKey) {
        throw new Error('Table "' + table + '" does not exist');
      }

      let modelSchema = models[modelKey];

      let schemaFieldData = modelSchema.columns.filter(function(v) {
        return v.name === column;
      }).pop();

      if (!schemaFieldData) {
        throw new Error('Column "' + column + '" of table "' + table + '" already exists');
      }

      schemaFieldData.name = newColumn;

      return true;

    }

    createIndex(table, column, type) {

      if (this.indices.filter(function(v) {
        return v.table === table && v.column === column;
      }).length) {
        throw new Error('Index already exists on column "' + column + '" of table "' + table + '"');
      }

      this.indices.push({table: table, column: column, type: type});

      return true

    }

    dropIndex(table, column) {

      this.indices = this.indices.filter(function(v) {
        return !(v.table === table && v.column === column);
      });

      return true;

    }

    generate() {

      let models = this.models;
      let indices = this.indices;
      let hasModels = !!Object.keys(models).length;
      let hasIndices = indices.length;

      let fileData = [
        '{',
        '',
        '  "migration_id": ' + this.migrationId + ((hasModels || hasIndices) ? ',' : ''),
      ];

      if (hasIndices) {

        fileData = fileData.concat([
          '',
          '  "indices": [',
            indices.map(function(indexData) {
              return [
                '    {',
                  [
                    '"table": "' + indexData.table + '"',
                    '"column": "' + indexData.column + '"',
                    (indexData.type ? '"type": "' + indexData.type+ '"' : '')
                  ].filter(function(v) { return !!v; }).join(', '),
                '}',
              ].join('');
            }).join('\n'),
          '  ]' + (hasModels ? ',' : ''),
        ]);

      }

      if (hasModels) {

        fileData = fileData.concat([
          '',
          '  "models": {',
          '',
          Object.keys(models).sort().map(function(t) {
            let curTable = models[t];
            return [
              '    "' + t + '": {',
              '',
              '      "table": "' + curTable.table + '",',
              '',
              '      "columns": [',
              curTable.columns.map(function(columnData) {
                return [
                  '        ',
                  '{',
                    [
                      '"name": "' + columnData.name + '"',
                      '"type": "' + columnData.type + '"',
                      columnData.properties ? '"properties": ' + JSON.stringify(columnData.properties) : ''
                    ].filter(function(v) { return !!v; }).join(', '),
                  '}'
                ].join('');
              }).join(',\n'),
              '      ]',
              '',
              '    }'
            ].join('\n');
          }).join(',\n\n'),
          '',
          '  }'
        ]);

      }

      return fileData.concat([
        '',
        '}',
        ''
      ]).join('\n');

    }

  }

  return SchemaGenerator;

})();
