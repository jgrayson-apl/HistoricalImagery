/*
 Copyright 2020 Esri

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

define([
  "calcite",
  "dojo/_base/declare",
  "ApplicationBase/ApplicationBase",
  "dojo/i18n!./nls/resources",
  "ApplicationBase/support/itemUtils",
  "ApplicationBase/support/domHelper",
  "dojo/_base/Color",
  "dojo/colors",
  "dojo/number",
  "dojo/date/locale",
  "dojo/on",
  "dojo/mouse",
  "dojo/query",
  "dojo/NodeList-dom",
  "dojo/dom-construct",
  "esri/identity/IdentityManager",
  "esri/core/Evented",
  "esri/core/watchUtils",
  "esri/core/promiseUtils",
  "esri/portal/Portal",
  "esri/Map",
  "esri/views/MapView",
  "esri/layers/Layer",
  "esri/layers/GraphicsLayer",
  "esri/geometry/Extent",
  "esri/geometry/Polygon",
  "esri/geometry/geometryEngine",
  "esri/Graphic",
  "esri/widgets/Home",
  "esri/widgets/Legend",
  "esri/widgets/Print",
  "esri/widgets/ScaleBar",
  "esri/widgets/Compass",
  "esri/widgets/Expand"
], function (calcite, declare, ApplicationBase, i18n, itemUtils, domHelper,
             Color, colors, number, locale, on, mouse, query, domNodeList, domConstruct,
             IdentityManager, Evented, watchUtils, promiseUtils,
             Portal, EsriMap, MapView, Layer, GraphicsLayer, Extent, Polygon, geometryEngine,
             Graphic, Home, Legend, Print, ScaleBar, Compass, Expand) {

  return declare([Evented], {

    /**
     *
     */
    constructor: function () {
      // APPLICATION BASE //
      this.base = null;
      // CALCITE WEB //
      calcite.init();
    },

    /**
     *
     * @param base
     */
    init: function (base) {
      if (!base) {
        console.error("ApplicationBase is not defined");
        return;
      }
      domHelper.setPageLocale(base.locale);
      domHelper.setPageDirection(base.direction);

      this.base = base;
      const config = base.config;
      const results = base.results;

      const allMapAndSceneItems = results.webMapItems.concat(results.webSceneItems);
      const validMapItems = allMapAndSceneItems.map(function (response) {
        return response.value;
      });

      const firstItem = validMapItems[0];
      if (!firstItem) {
        console.error("Could not load an item to display");
        return;
      }
      config.title = (config.title || itemUtils.getItemTitle(firstItem));
      domHelper.setPageTitle(config.title);

      if (firstItem.description) {
        document.getElementById("app-description-panel").innerHTML = firstItem.description;
      }

      const viewProperties = itemUtils.getConfigViewProperties(config);
      viewProperties.container = "view-container";
      viewProperties.constraints = {snapToZoom: false};
      viewProperties.center = [-120.44840133926529, 34.506529904857615];
      viewProperties.scale = 81773.4641244801;

      const portalItem = this.base.results.applicationItem.value;
      const appProxies = (portalItem && portalItem.appProxies) ? portalItem.appProxies : null;

      itemUtils.createMapFromItem({item: firstItem, appProxies: appProxies}).then((map) => {
        viewProperties.map = map;
        itemUtils.createView(viewProperties).then((view) => {
          view.when(() => {
            this.viewReady(config, firstItem, view);
          });
        });
      });
    },

    /**
     *
     * @param config
     * @param item
     * @param view
     */
    viewReady: function (config, item, view) {

      // TITLE //
      document.getElementById("app-title-node").innerHTML = config.title;

      // LOADING //
      const updating_node = domConstruct.create("div", {className: "view-loading-node loader"});
      domConstruct.create("div", {className: "loader-bars"}, updating_node);
      domConstruct.create("div", {className: "loader-text font-size--3 text-white", innerHTML: "Updating..."}, updating_node);
      view.ui.add(updating_node, "bottom-right");
      watchUtils.init(view, "updating", (updating) => {
        updating_node.classList.toggle("is-active", updating);
      });

      // PANEL TOGGLE //
      if (query(".pane-toggle-target").length > 0) {
        const panelToggleBtn = domConstruct.create("div", {className: "panel-toggle icon-ui-left-triangle-arrow icon-ui-flush font-size-1", title: "Toggle Left Panel"}, view.root);
        panelToggleBtn.addEventListener("click", () => {
          panelToggleBtn.classList.toggle("icon-ui-left-triangle-arrow");
          panelToggleBtn.classList.toggle("icon-ui-right-triangle-arrow");
          query(".pane-toggle-target").toggleClass("collapsed");
          query(".pane-toggle-source").toggleClass("expanded");
        });
      }

      // USER SIGN IN //
      return this.initializeUserSignIn().catch(console.warn).then(() => {

        // HOME //
        view.ui.add(new Home({view: view}), {position: "top-left", index: 0});

        // COMPASS //
        view.ui.add(new Compass({view: view}), {position: "top-left"});

        // SCALEBAR //
        view.ui.add(new ScaleBar({view: view, unit: 'dual'}), {position: "bottom-left", index: 0});

        // PRINT //
        const print = new Print({
          view: view,
          printServiceUrl: (config.helperServices.printTask.url || this.base.portal.helperServices.printTask.url),
          templateOptions: {title: config.title, author: this.base.portal.user ? this.base.portal.user.fullName : ""}
        }, "print-node");
        this.updatePrintOptions = (title, author, copyright) => {
          print.templateOptions.title = title || print.templateOptions.title;
          print.templateOptions.author = author || print.templateOptions.author;
          print.templateOptions.copyright = copyright || print.templateOptions.copyright;
        };
        this.on("portal-user-change", () => {
          this.updatePrintOptions(config.title, this.base.portal.user ? this.base.portal.user.fullName : "");
        });

        // HISTORICAL IMAGERY //
        this.initializeHistoricalImagery(view);

      });

    },

    /**
     *
     * @returns {*}
     */
    initializeUserSignIn: function () {

      const checkSignInStatus = () => {
        return IdentityManager.checkSignInStatus(this.base.portal.url).then(userSignIn).catch(userSignOut).then();
      };
      IdentityManager.on("credential-create", checkSignInStatus);

      // SIGN IN //
      const userSignIn = () => {
        this.base.portal = new Portal({url: this.base.config.portalUrl, authMode: "immediate"});
        return this.base.portal.load().then(() => {
          this.emit("portal-user-change", {});
        }).catch(console.warn).then();
      };

      // SIGN OUT //
      const userSignOut = () => {
        IdentityManager.destroyCredentials();
        this.base.portal = new Portal({});
        return this.base.portal.load().then(() => {
          this.base.portal.user = null;
          this.emit("portal-user-change", {});
        }).catch(console.warn).then();

      };

      return checkSignInStatus();
    },

    /**
     *
     * @param view
     */
    initializeHistoricalImagery: function (view) {

      this.initializeOverviewMap(view).then(() => {
        this.initializeZoomWindow(view);

        const imageryFootprintsLayer = view.map.layers.find(layer => {
          return (layer.title === "Imagery Footprints");
        });
        imageryFootprintsLayer.load().then(() => {
          imageryFootprintsLayer.outFields = ["*"];
          imageryFootprintsLayer.visible = false;


          const imageryLayers = view.map.layers.filter(layer => {
            return layer.title.startsWith('Preserve - ');
          })

          /*const imageryLayersInfos = view.map.layers.reduce((infos, layer) => {
           if(layer.title.startsWith('Preserve - ')){
           const year = Number(layer.title.split(' - ')[1]);
           infos.years.push(year);
           infos.layers.push(layer);
           infos.layerByYear[year] = layer;
           }
           return infos;
           }, { years: [], layers: [], layerByYear: {} });
           const years = imageryLayersInfos.years.sort();
           const imageryLayers = imageryLayersInfos.layers;

           const imageryLayersByYear = years.reduce((byYear, year) => {
           return byYear.set(year, imageryLayersInfos.layerByYear[year]);
           }, new Map());*/

          const _getImageryLayerYear = (layer) => {
            return Number(layer.title.split(' - ')[1]);
          };
          this.displayCurrentImagery = year => {
            imageryLayers.forEach(imageryLayer => {
              imageryLayer.visible = (_getImageryLayerYear(imageryLayer) === year);
            });
          };
          this.displayCurrentImagery(-1);

          this.findImageryLayerByYear = year => {
            return imageryLayers.find(imageryLayer => {
              return (_getImageryLayerYear(imageryLayer) === year);
            });
          };

          this.findVisibleImageryLayer = () => {
            return imageryLayers.find(imageryLayer => {
              return imageryLayer.visible;
            });
          };

          this.setImageryLayerOpacity = opacity => {
            imageryLayers.forEach(layer => {
              layer.opacity = opacity;
            });
          };

          const layerDetailsTitle = document.getElementById('layer-details-title');
          const layerDetailsDescription = document.getElementById('layer-details-description');
          this.displayLayerDetails = year => {
            const imageryLayer = this.findImageryLayerByYear(year);
            const portalItem = imageryLayer.portalItem;
            if (portalItem) {
              layerDetailsTitle.innerHTML = portalItem.title;
              layerDetailsDescription.innerHTML = portalItem.description;
              calcite.bus.emit('modal:open', {id: 'layer-details-dialog'});
            } else {
              console.error("Can't find Layer PortalItem for year: ", year);
            }
          };

          this.initializeLayerOpacity(view, imageryLayers);
          this.initializeLayerFadeTool(view, imageryLayers);
          this.initializeItemsList(view, imageryFootprintsLayer);

        });
      });

    },

    /**
     *
     * @param view
     * @param imageryFootprintsLayer
     */
    initializeItemsList: function (view, imageryFootprintsLayer) {

      imageryFootprintsLayer.queryFeatures({
        where: "1=1",
        outFields: ["Year", "PercentCoverage", "ColorType"],
        orderByFields: ["Year ASC"],
        returnGeometry: true
      }).then(featureSet => {
        domConstruct.empty("items-list");

        // FEATURE COUNT //
        const featureCount = featureSet.features.length;

        // FEATURE BY NODE //
        const featureByNode = featureSet.features.reduce((byNode, feature, feature_idx) => {
          // ITEM NODE //
          const itemNode = this.addItemNode(view, feature, (feature_idx === 0));
          return byNode.set(itemNode, feature);
        }, new Map());

        //
        // FOOTPRINTS //
        //
        // LEAVE //
        query(".item-node").on(mouse.leave, () => {
          this.updateFootprint();
        });
        // ENTER //
        query(".item-node").on(mouse.enter, (evt) => {
          const feature = featureByNode.get(evt.target);
          if (feature) {
            this.updateFootprint(feature.geometry.clone());
          }
        });

        // DISABLE BASED ON CURRENT EXTENT AND FOOTPRINT //
        this.disableExtentIntersect = (extent) => {
          query(".item-node").forEach(node => {
            const feature = featureByNode.get(node);
            if (feature) {
              node.classList.toggle("btn-disabled", !extent.intersects(feature.geometry));
            }
          });
          document.getElementById("items-list-count").innerHTML = `${ number.format(query(".item-node:not(.btn-disabled)", "items-list").length) } of ${ featureCount }`;
        };

        this.initializeViewExtentEvents();

      });
    },

    /**
     *
     * @param view
     * @param feature
     * @param selected
     */
    addItemNode: function (view, feature, selected) {

      // ITEM NODE //
      const itemNode = domConstruct.create("div", {
        className: "item-node side-nav-link",
      }, "items-list");
      itemNode.addEventListener("click", () => {

        query(".item-node").removeClass("selected");
        itemNode.classList.add("selected");

        this.displayCurrentImagery(feature.attributes.Year);
        this.updateCurrentFootprint(feature.geometry.clone());

      });
      if (selected) { itemNode.click(); }

      const topNode = domConstruct.create("div", {
        className: "item-top-node margin-right-1"
      }, itemNode);

      domConstruct.create("div", {
        className: "item-year-node avenir-demi font-size-3",
        innerHTML: feature.attributes.Year
      }, topNode);

      const infoNode = domConstruct.create("div", {
        className: "item-info-node icon-ui-description",
        title: "Get imagery details..."
      }, topNode);
      infoNode.addEventListener('click', clickEvt => {
        clickEvt.stopPropagation();
        this.displayLayerDetails(feature.attributes.Year);
      });

      const details_node = domConstruct.create("div", {
        className: "item-details-node margin-left-1 margin-right-1"
      }, itemNode);

      domConstruct.create("div", {
        innerHTML: `Type: <span class="avenir-demi">${ feature.attributes.ColorType || 'n/a' }</span>`,
        title: "Color Type"
      }, details_node);

      const coverageNode = domConstruct.create("div", {
        innerHTML: `Coverage: <span class="avenir-demi">${ feature.attributes.PercentCoverage || 'n/a' }%</span>`
      }, details_node);

      domConstruct.create("progress", {
        max: 100,
        value: feature.attributes.PercentCoverage || 0
      }, coverageNode);

      return itemNode;
    },

    /**
     *
     * @param view
     */
    initializeOverviewMap: function (view) {

      const overviewView = new MapView({
        container: "overview-view",
        map: new EsriMap({
          basemap: "hybrid",
          layers: []
        }),
        extent: view.extent.clone().expand(1.2),
        ui: {components: []},
        constraints: {snapToZoom: false}
      });
      return overviewView.when(() => {

        const mapExtentGraphic = new Graphic({
          geometry: view.extent.clone(),
          symbol: {
            type: "simple-fill",
            color: Color.named.transparent,
            outline: {
              type: "simple-line",
              color: Color.named.white,
              width: 1.5,
              style: "dash"
            }
          }
        });
        const footprintGraphic = new Graphic({
          symbol: {
            type: "simple-fill",
            color: Color.named.transparent,
            outline: {
              type: "simple-line",
              color: Color.named.white,
              width: 1.0
            }
          }
        });
        const currentFootprintGraphic = new Graphic({
          symbol: {
            type: "simple-fill",
            color: Color.named.transparent,
            outline: {
              type: "simple-line",
              color: Color.named.lime,
              width: 1.5
            }
          }
        });

        const footprintLayer = new GraphicsLayer({title: "Footprints", graphics: [mapExtentGraphic, footprintGraphic, currentFootprintGraphic]});
        overviewView.map.add(footprintLayer);

        const maskGraphic = new Graphic({
          symbol: {
            type: "simple-fill",
            color: Color.named.white.concat(0.5),
            outline: {
              type: "simple-line",
              color: Color.named.white,
              width: 0.5
            }
          }
        });
        const maskLayer = new GraphicsLayer({title: "Mask", graphics: [maskGraphic]});
        view.map.add(maskLayer);


        this.updateCurrentFootprint = (geometry) => {
          currentFootprintGraphic.geometry = geometry;
        };
        this.updateFootprint = (geometry) => {
          footprintGraphic.geometry = geometry;
        };

        const _polylineToPolygon = polyline =>{
          return new Polygon({
            spatialReference: polyline.spatialReference,
            rings: polyline.paths
          });
        }

        this.initializeViewExtentEvents = () => {

          const boundaryLayer = view.map.layers.find(layer => { return (layer.title === "Preserve Boundary"); });
          return boundaryLayer.load().then(() => {
            return boundaryLayer.queryFeatures().then(featureSet => {
              const _boundaryPolygon = geometryEngine.geodesicBuffer(_polylineToPolygon(featureSet.features[0].geometry), 750.0, "meters");

              return watchUtils.init(view, "extent", extent => {
                mapExtentGraphic.geometry = extent;
                maskGraphic.geometry = geometryEngine.difference(extent.clone().expand(1.1), _boundaryPolygon);
                this.disableExtentIntersect(extent);
              });

            });
          });
        }

      });

    },

    /**
     *
     * @param view
     * @param imageryLayers
     */
    initializeLayerOpacity: function (view, imageryLayers) {

      const opacity_input = document.getElementById("opacity-input");
      opacity_input.addEventListener("input", () => {
        imageryLayers.forEach(layer => {
          layer.opacity = opacity_input.valueAsNumber;
        });
      });

      imageryLayers.forEach(layer => {
        layer.watch("opacity", () => {
          opacity_input.valueAsNumber = layer.opacity;
        });
      });

    },

    /**
     *
     * @param view
     */
    initializeZoomWindow: function (view) {

      // ZOOM WINDOW ENABLED //
      let zoom_window_enabled = false;

      // ZOOM WINDOW BUTTON //
      const zoom_window_btn = domConstruct.create("div", {
        className: "zoom-window-btn esri-widget--button esri-widget esri-icon esri-icon-zoom-in-magnifying-glass",
        title: "Zoom Window\n - click, hold, then drag..."
      });
      view.ui.add(zoom_window_btn, {position: "top-right"});

      this.enableZoomWindowTool = (enabled) => {
        zoom_window_btn.classList.toggle("selected", enabled);
        zoom_window_enabled = zoom_window_btn.classList.contains("selected");
        view.container.style.cursor = zoom_window_enabled ? "all-scroll" : "default";
      };

      zoom_window_btn.addEventListener('click', () => {
        this.enableLayerFadeTool(false);
        this.enableZoomWindowTool(!zoom_window_btn.classList.contains("selected"));
      });

      // CONTAINER //
      const zoom_container = domConstruct.create("div", {className: "zoom-view-node panel panel-dark hide"}, view.root, "first");

      // CALC WINDOW POSITION //
      const window_offset = 12;
      const zoom_window_position = (pos_evt) => {
        const top_offset = (pos_evt.y < (view.height - 200)) ? window_offset : -150 - window_offset;
        const left_offset = (pos_evt.x < (view.width - 200)) ? window_offset : -150 - window_offset;
        zoom_container.style.setProperty('top', `${ (pos_evt.y + top_offset) }px`);
        zoom_container.style.setProperty('left', `${ (pos_evt.x + left_offset) }px`);
      };

      // DISPLAY ZOOM WINDOW //
      const display_zoom_window = (position_evt) => {
        domConstruct.place(zoom_container, view.root, position_evt ? "last" : "first");
        zoom_container.classList.toggle("hide", !position_evt);
        if (position_evt) {
          zoom_window_position(position_evt);
        }
      };

      // MAP VIEW //
      const zoom_view = new MapView({
        container: zoom_container,
        ui: {components: []},
        map: view.map
      });

      // IS WITHIN VIEW //
      const is_within_view = (evt) => {
        return (evt.x > 0) && (evt.x < view.width) && (evt.y > 0) && (evt.y < view.height);
      };

      // ZOOM LEVEL OFFSET //
      const zoom_level_offset = 3;
      // LAST EVENT //
      let last_evt = null;

      // UPDATE ZOOM WINDOW //
      const update_zoom_window = (view_evt) => {
        if (is_within_view(view_evt)) {
          const map_point = view.toMap(view_evt);
          if (map_point) {
            last_evt = view_evt;

            // DISPLAY ZOOM WINDOW //
            display_zoom_window(view_evt);

            // GOTO //
            zoom_view.goTo({
              target: map_point,
              zoom: (view.zoom + zoom_level_offset)
            }, {animate: false});

          } else {
            // IN 3D IF NOT ON GLOBE //
            display_zoom_window();
            last_evt = null;
          }
        } else {
          // NOT WITHIN VIEW //
          display_zoom_window();
          last_evt = null;
        }
      };

      // POINTER DOWN //
      view.on("pointer-down", (pointer_down_evt) => {
        if (zoom_window_enabled) {
          pointer_down_evt.stopPropagation();
          if (pointer_down_evt.button === 0) {
            update_zoom_window(pointer_down_evt);
          }
        }
      });

      // DRAG //
      view.on("drag", (drag_evt) => {
        if (zoom_window_enabled) {
          drag_evt.stopPropagation();
          switch (drag_evt.action) {
            case "update":
              update_zoom_window(drag_evt);
              break;
            default:
              last_evt = null;
          }
        }
      });

      // POINTER UP //
      view.on("pointer-up", () => {
        if (zoom_window_enabled) {
          display_zoom_window();
          last_evt = null;
        }
      });
      // POINTER LEAVE //
      view.on("pointer-leave", () => {
        if (zoom_window_enabled) {
          display_zoom_window();
          last_evt = null;
        }
      });

    },

    /**
     *
     * @param view
     * @param imageryLayers
     */
    initializeLayerFadeTool: function (view, imageryLayers) {

      // FADE TOOL ENABLED //
      let layer_fade_enabled = false;

      // LAYER FADE BUTTON //
      const layer_fade_btn = domConstruct.create("div", {
        className: "layer-fade-btn esri-widget--button esri-widget esri-icon esri-icon-up-down-arrows",
        title: "Layer Fade\n - hold to fade layer..."
      });
      view.ui.add(layer_fade_btn, {position: "top-right"});

      this.enableLayerFadeTool = (enabled) => {
        layer_fade_btn.classList.toggle("selected", enabled);
        layer_fade_enabled = layer_fade_btn.classList.contains("selected");
        view.container.style.cursor = layer_fade_enabled ? "pointer" : "default";
      };

      layer_fade_btn.addEventListener('click', () => {
        this.enableZoomWindowTool(false);
        this.enableLayerFadeTool(!layer_fade_btn.classList.contains("selected"));
      });

      let fade_layer;

      const fps = 30;
      let max_opacity = 1.0;

      let fade_in_handle;
      const fade_in = () => {
        fade_layer.opacity += 0.01;
        if (fade_layer.opacity < max_opacity) {
          fade_in_handle = setTimeout(() => { fade_in(); }, 1000 / fps);
        } else {
          this.setImageryLayerOpacity(fade_layer.opacity);
          clearTimeout(fade_in_handle);
        }
      };

      let fade_out_handle;
      const fade_out = () => {
        fade_layer.opacity -= 0.01;
        if (fade_layer.opacity > 0.0) {
          fade_out_handle = setTimeout(() => { fade_out(); }, 1000 / fps);
        } else {
          this.setImageryLayerOpacity(fade_layer.opacity);
          clearTimeout(fade_out_handle)
        }
      };


      // POINTER DOWN //
      view.on("hold", (hold_evt) => {
        if (layer_fade_enabled) {
          hold_evt.stopPropagation();
          clearTimeout(fade_in_handle);
          fade_layer = this.findVisibleImageryLayer();
          max_opacity = fade_layer.opacity;
          fade_out();
        }
      });

      // POINTER UP //
      view.on("pointer-up", (pointer_up_evt) => {
        if (layer_fade_enabled) {
          pointer_up_evt.stopPropagation();
          clearTimeout(fade_out_handle);
          fade_in(max_opacity);
        }
      });

    }

  });
});
